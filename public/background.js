const INSTAGRAM_URL_PATTERN = /^https:\/\/www\.instagram\.com\//;
const WHITELIST_STORAGE_KEY = "iu_whitelisted-results";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "open-unfollowers",
    title: "Open Unfollowers",
    contexts: ["page"],
    documentUrlPatterns: ["https://www.instagram.com/*"],
  });
});

chrome.action.onClicked.addListener((tab) => {
  void openUnfollowers(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "open-unfollowers" && tab !== undefined) {
    void openUnfollowers(tab);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return true;
});

async function openUnfollowers(tab) {
  const tabId = tab.id;
  const url = tab.url ?? "";
  const page = new URL(chrome.runtime.getURL("index.html"));

  if (typeof tabId === "number" && INSTAGRAM_URL_PATTERN.test(url)) {
    page.searchParams.set("tabId", String(tabId));
  } else {
    page.searchParams.set("launchError", "not-instagram");
  }

  await chrome.tabs.create({
    url: page.toString(),
    index: typeof tab.index === "number" ? tab.index + 1 : undefined,
  });
}

async function handleMessage(message) {
  if (message === null || typeof message !== "object") {
    throw new Error("Invalid extension message");
  }

  if (message.type === "IG_FETCH_FOLLOWING") {
    const followingPage = await executeInstagramTask(
      message.tabId,
      fetchFollowingPageInInstagram,
      message.after ?? null,
    );
    return inlineFollowingAvatars(followingPage);
  }

  if (message.type === "IG_UNFOLLOW_USER") {
    return executeInstagramTask(
      message.tabId,
      unfollowUserInInstagram,
      {
        userId: message.userId,
        username: message.username,
      },
    );
  }

  if (message.type === "OPEN_URL") {
    await chrome.tabs.create({ url: message.url });
    return undefined;
  }

  if (message.type === "COPY_TEXT") {
    await navigator.clipboard.writeText(message.text ?? "");
    return undefined;
  }

  if (message.type === "DOWNLOAD_TEXT") {
    const mimeType = message.mimeType ?? "text/plain";
    const filename = message.filename ?? "unfollowers.txt";
    const dataUrl = `data:${mimeType};charset=utf-8,${encodeURIComponent(message.content ?? "")}`;
    await chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: true,
    });
    return undefined;
  }

  if (message.type === "GET_WHITELIST") {
    const result = await chrome.storage.local.get(WHITELIST_STORAGE_KEY);
    return Array.isArray(result[WHITELIST_STORAGE_KEY])
      ? result[WHITELIST_STORAGE_KEY]
      : [];
  }

  if (message.type === "SAVE_WHITELIST") {
    await chrome.storage.local.set({
      [WHITELIST_STORAGE_KEY]: Array.isArray(message.users)
        ? message.users
        : [],
    });
    return undefined;
  }

  throw new Error("Unknown extension message");
}

async function inlineFollowingAvatars(followingPage) {
  return {
    ...followingPage,
    edges: await Promise.all(
      followingPage.edges.map(async (edge) => ({
        ...edge,
        node: {
          ...edge.node,
          profile_pic_url: await inlineAvatarInBackground(edge.node.profile_pic_url),
        },
      })),
    ),
  };
}

async function inlineAvatarInBackground(url) {
  if (typeof url !== "string" || url === "" || url.startsWith("data:")) {
    return url;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return url;
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";

    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return `data:${contentType};base64,${btoa(binary)}`;
  } catch {
    return url;
  }
}

async function executeInstagramTask(tabId, func, arg) {
  if (!Number.isInteger(tabId)) {
    throw new Error("Missing Instagram tab. Open Unfollowers from Instagram.");
  }

  const [injectionResult] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func,
    args: [arg],
  });

  const result = injectionResult?.result;
  if (result?.ok) {
    return result.data;
  }

  throw new Error(result?.error ?? "Instagram script did not return a result");
}

async function fetchFollowingPageInInstagram(after) {
  try {
    const readInstagramCookie = (name) => {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);

      if (parts.length !== 2) {
        return null;
      }

      return parts.pop().split(";").shift();
    };

    const inlineImage = async (url) => {
      if (typeof url !== "string" || url === "") {
        return "";
      }

      try {
        const response = await fetch(url, {
          credentials: "include",
          referrer: "https://www.instagram.com/",
        });

        if (!response.ok) {
          return url;
        }

        const blob = await response.blob();

        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve(typeof reader.result === "string" ? reader.result : url);
          };
          reader.onerror = () => {
            resolve(url);
          };
          reader.readAsDataURL(blob);
        });
      } catch {
        return url;
      }
    };

    const dsUserId = readInstagramCookie("ds_user_id");
    if (dsUserId === null) {
      throw new Error("Instagram user cookie not found. Sign in to Instagram and try again.");
    }

    const variables = {
      id: dsUserId,
      include_reel: true,
      fetch_mutual: false,
      first: 24,
      ...(after === null ? {} : { after }),
    };
    const url = `https://www.instagram.com/graphql/query/?query_hash=3dec7e2c57367ef3da3d987d89f9dbc8&variables=${encodeURIComponent(JSON.stringify(variables))}`;
    const response = await fetch(url, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Instagram scan request failed with ${response.status}`);
    }

    const json = await response.json();
    const followingPage = json?.data?.user?.edge_follow;
    if (followingPage === undefined) {
      throw new Error("Instagram did not return a following list.");
    }

    followingPage.edges = await Promise.all(
      followingPage.edges.map(async (edge) => ({
        ...edge,
        node: {
          ...edge.node,
          profile_pic_url: await inlineImage(edge.node.profile_pic_url),
        },
      })),
    );

    return { ok: true, data: followingPage };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function unfollowUserInInstagram(payload) {
  try {
    const userId = payload.userId;
    const username = payload.username;
    const readInstagramCookie = (name) => {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);

      if (parts.length !== 2) {
        return null;
      }

      return parts.pop().split(";").shift();
    };
    const getWebAppConfig = () => {
      const scripts = Array.from(document.scripts)
        .map((script) => script.textContent ?? "")
        .join("\n");
      const rolloutHash =
        scripts.match(/"rollout_hash":"([^"]+)"/)?.[1] ??
        scripts.match(/"rolloutHash":"([^"]+)"/)?.[1] ??
        "";
      const appId = "936619743392459";

      return { appId, rolloutHash };
    };

    const csrfToken = readInstagramCookie("csrftoken");
    if (csrfToken === null) {
      throw new Error("Instagram CSRF cookie not found. Sign in to Instagram and try again.");
    }
    const { appId, rolloutHash } = getWebAppConfig();
    const headers = {
      accept: "*/*",
      "content-type": "application/x-www-form-urlencoded",
      "x-asbd-id": "129477",
      "x-csrftoken": csrfToken,
      "x-ig-app-id": appId,
      "x-instagram-ajax": rolloutHash,
      "x-requested-with": "XMLHttpRequest",
    };
    const referer =
      typeof username === "string" && username !== ""
        ? `https://www.instagram.com/${username}/`
        : "https://www.instagram.com/";

    const response = await postUnfollow(
      `https://www.instagram.com/api/v1/friendships/destroy/${userId}/`,
      headers,
      referer,
    );

    if (response.ok) {
      return { ok: true, data: { status: response.status } };
    }

    const fallbackResponse = await postUnfollow(
      `https://www.instagram.com/web/friendships/${userId}/unfollow/`,
      headers,
      referer,
    );

    if (!fallbackResponse.ok) {
      throw new Error(
        `Instagram unfollow request failed with ${response.status}/${fallbackResponse.status}`,
      );
    }

    return { ok: true, data: { status: fallbackResponse.status } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  async function postUnfollow(url, headers, referrer) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers,
      referrer,
      body: "",
    });

    if (!response.ok) {
      return response;
    }

    const text = await response.clone().text();
    if (text === "") {
      return response;
    }

    try {
      const json = JSON.parse(text);
      if (
        json.status === "ok" ||
        json.friendship_status?.following === false ||
        json.following === false
      ) {
        return response;
      }

      return new Response(text, {
        status: 500,
        statusText: "Instagram did not confirm unfollow",
      });
    } catch {
      return response;
    }
  }
}
