const frame = document.createElement("iframe");
const backgrounds = {
  light: "oklch(1 0 0)",
  dark: "oklch(0.145 0 0)",
};

function setShellTheme(theme) {
  const background = theme === "dark" ? backgrounds.dark : backgrounds.light;

  document.documentElement.style.transition =
    "background-color 260ms cubic-bezier(0.16, 1, 0.3, 1)";
  document.body.style.transition =
    "background-color 260ms cubic-bezier(0.16, 1, 0.3, 1)";
  frame.style.transition =
    "background-color 260ms cubic-bezier(0.16, 1, 0.3, 1)";
  document.documentElement.style.backgroundColor = background;
  document.body.style.backgroundColor = background;
  document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light";
  frame.style.backgroundColor = background;
}

frame.src = `sandbox.html${window.location.search}`;
frame.title = "Unfollowers";
frame.style.border = "0";
frame.style.width = "100vw";
frame.style.height = "100vh";
frame.style.display = "block";

document.documentElement.style.margin = "0";
document.documentElement.style.width = "100%";
document.documentElement.style.height = "100%";
document.body.style.margin = "0";
document.body.style.width = "100%";
document.body.style.height = "100%";
document.body.style.overflow = "hidden";
setShellTheme(
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
);
document.body.append(frame);

window.addEventListener("message", (event) => {
  const data = event.data;
  if (
    data !== null &&
    typeof data === "object" &&
    data.source === "unfollowers-theme" &&
    (data.theme === "dark" || data.theme === "light")
  ) {
    setShellTheme(data.theme);
    return;
  }

  if (
    data !== null &&
    typeof data === "object" &&
    data.source === "unfollowers-copy" &&
    typeof data.text === "string"
  ) {
    navigator.clipboard
      .writeText(data.text)
      .then(() => {
        frame.contentWindow.postMessage(
          {
            source: "unfollowers-shell",
            id: data.id,
            response: { ok: true },
          },
          "*",
        );
      })
      .catch((error) => {
        frame.contentWindow.postMessage(
          {
            source: "unfollowers-shell",
            id: data.id,
            response: {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            },
          },
          "*",
        );
      });
    return;
  }

  if (
    data === null ||
    typeof data !== "object" ||
    data.source !== "unfollowers-ui" ||
    typeof data.id !== "number"
  ) {
    return;
  }

  chrome.runtime.sendMessage(data.message, (response) => {
    const runtimeError = chrome.runtime.lastError;
    frame.contentWindow.postMessage(
      {
        source: "unfollowers-shell",
        id: data.id,
        response:
          runtimeError === undefined
            ? response
            : {
                ok: false,
                error: runtimeError.message ?? "Chrome runtime error",
              },
      },
      "*",
    );
  });
});
