<script lang="ts">
  import {
    ArrowUpRight,
    Check,
    Copy,
    Download,
    Loader2,
    Lock,
    Moon,
    RefreshCw,
    Search,
    Settings,
    ShieldCheck,
    Sun,
    Timer,
    X,
  } from "lucide-svelte";
  import { onMount } from "svelte";
  import {
    type AppUser,
    type TimingsConfig,
    copyText,
    downloadTextFile,
    fetchFollowingPage,
    getInstagramTabId,
    loadStoredWhitelistedUsers,
    loadTimingsConfig,
    openExternalUrl,
    saveStoredWhitelistedUsers,
    saveTimingsConfig,
    sleep,
    toAppUser,
    unfollowInstagramUser,
  } from "@/lib/instagram-bridge";
  import { cn } from "@/lib/utils";

  type Filter = "all" | "unfollowed" | "whitelisted";
  type Task = {
    type: "scan" | "unfollow";
    progress: number;
    total: number;
    message: string;
    isWaiting?: boolean;
  };

  const instagramTabId = getInstagramTabId();
  const TABS: readonly { id: Filter; label: string }[] = [
    { id: "unfollowed", label: "Unfollowed" },
    { id: "whitelisted", label: "Whitelisted" },
    { id: "all", label: "All" },
  ];

  const inputClass =
    "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";
  const checkboxClass =
    "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input transition-colors outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary";
  const avatarClass =
    "group/avatar relative flex size-8 shrink-0 rounded-full select-none after:absolute after:inset-0 after:rounded-full after:border after:border-border after:mix-blend-darken data-[size=lg]:size-10 data-[size=sm]:size-6 dark:after:mix-blend-lighten";
  const dropdownItemClass =
    "group/dropdown-menu-item relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive";

  let needsCookieAuth = $state(instagramTabId === null);
  let users = $state<AppUser[]>([]);
  let whitelistedUsers = $state<readonly AppUser[]>([]);
  let selectedUsers = $state(new Set<string>());
  let filter = $state<Filter>("unfollowed");
  let searchTerm = $state("");
  let showSettings = $state(false);
  let renderedPanel = $state<"settings" | "main" | null>("main");
  let showExportMenu = $state(false);
  let exportMenuStyle = $state("");
  let activeTask = $state<Task | null>(null);
  let brokenAvatarIds = $state(new Set<string>());
  let resolvedTheme = $state<"light" | "dark">("light");
  let themeSetting: "light" | "dark" | "system" = "system";
  let exportMenuElement = $state<HTMLDivElement | null>(null);
  let exportButtonElement = $state<HTMLButtonElement | null>(null);
  let tabContainerElement = $state<HTMLDivElement | null>(null);
  let tabIndicatorStyle = $state("");
  let themeTransitionTimeout = 0;
  let panelSwapTimeout = 0;
  let tabSpringFrame = 0;
  let tabSpringLastTime = 0;
  const tabRect = {
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  };
  const tabVelocity = {
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  };
  const tabTarget = {
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  };
  let tabSpringInitialized = false;
  const tabButtonElements = new Map<Filter, HTMLButtonElement>();
  let config = $state<TimingsConfig>(
    loadTimingsConfig() ?? {
      searchCycleTime: 200,
      searchCycleWait: 2000,
      unfollowTime: 800,
      unfollowWait: 5000,
    },
  );

  const filteredUsers = $derived.by(() => {
    const normalizedSearchTerm = searchTerm.toLowerCase();

    return users.filter((user) => {
      const matchesFilter =
        filter === "all"
          ? true
          : filter === "whitelisted"
            ? user.isWhitelisted
            : !user.isWhitelisted && !user.followsViewer;
      const matchesSearch =
        normalizedSearchTerm === "" ||
        user.handle.toLowerCase().includes(normalizedSearchTerm) ||
        user.name.toLowerCase().includes(normalizedSearchTerm);

      return matchesFilter && matchesSearch;
    });
  });

  $effect(() => {
    if (!showExportMenu) {
      return;
    }

    updateExportMenuPosition();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (
        exportMenuElement?.contains(target) ||
        exportButtonElement?.contains(target)
      ) {
        return;
      }

      showExportMenu = false;
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updateExportMenuPosition);
    window.addEventListener("scroll", updateExportMenuPosition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updateExportMenuPosition);
      window.removeEventListener("scroll", updateExportMenuPosition, true);
    };
  });

  $effect(() => {
    filter;
    showSettings;
    window.requestAnimationFrame(updateTabIndicator);
  });

  onMount(() => {
    let storedTheme: string | null = null;
    try {
      storedTheme = localStorage.getItem("theme");
    } catch {
      storedTheme = null;
    }

    themeSetting =
      storedTheme === "light" || storedTheme === "dark" ? storedTheme : "system";
    syncTheme();

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleThemeChange = () => {
      if (themeSetting === "system") {
        syncTheme();
      }
    };

    media.addEventListener("change", handleThemeChange);
    window.addEventListener("resize", updateTabIndicator);
    void scanFollowing();

    return () => {
      media.removeEventListener("change", handleThemeChange);
      window.removeEventListener("resize", updateTabIndicator);
    };
  });

  function getSystemTheme(): "light" | "dark" {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function syncTheme() {
    const theme = themeSetting === "system" ? getSystemTheme() : themeSetting;
    const background =
      theme === "dark" ? "oklch(0.145 0 0)" : "oklch(1 0 0)";

    resolvedTheme = theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.body.classList.toggle("dark", theme === "dark");
    document.documentElement.style.backgroundColor = background;
    document.body.style.backgroundColor = background;
    document.documentElement.style.colorScheme = theme;
    window.parent.postMessage(
      {
        source: "unfollowers-theme",
        theme,
      },
      "*",
    );
  }

  function setTheme(theme: "light" | "dark") {
    window.clearTimeout(themeTransitionTimeout);
    document.documentElement.classList.add("theme-transition");
    document.body.classList.add("theme-transition");

    themeSetting = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // Theme still updates in-memory if sandbox storage is unavailable.
    }
    syncTheme();

    themeTransitionTimeout = window.setTimeout(() => {
      document.documentElement.classList.remove("theme-transition");
      document.body.classList.remove("theme-transition");
    }, 320);
  }

  function toggleSettings() {
    const nextShowSettings = !showSettings;
    const nextPanel = nextShowSettings ? "settings" : "main";

    showSettings = nextShowSettings;
    window.clearTimeout(panelSwapTimeout);

    if (renderedPanel === nextPanel) {
      return;
    }

    renderedPanel = null;
    panelSwapTimeout = window.setTimeout(() => {
      renderedPanel = nextPanel;
    }, 400);
  }

  async function scanFollowing() {
    if (instagramTabId === null) {
      needsCookieAuth = true;
      return;
    }

    needsCookieAuth = false;
    const storedWhitelist = await loadStoredWhitelistedUsers();
    const whitelistedIds = new Set(storedWhitelist.map((user) => user.id));
    whitelistedUsers = storedWhitelist;
    users = [];
    activeTask = {
      type: "scan",
      progress: 0,
      total: 1,
      message: "Initializing scan...",
    };

    let after: string | null = null;
    let hasNextPage = true;
    let scannedCount = 0;
    let totalCount = 1;
    let scanCycle = 0;
    let scannedUsers: AppUser[] = [];

    try {
      while (hasNextPage) {
        const page = await fetchFollowingPage(instagramTabId, after);
        totalCount = Math.max(page.count, 1);
        scannedCount += page.edges.length;
        scannedUsers = [
          ...scannedUsers,
          ...page.edges.map(({ node }) => toAppUser(node, whitelistedIds)),
        ];

        users = scannedUsers;
        activeTask = {
          type: "scan",
          progress: Math.min(scannedCount, totalCount),
          total: totalCount,
          message: `Scanning account ${Math.min(scannedCount, totalCount)} of ${totalCount}...`,
        };

        hasNextPage = page.page_info.has_next_page;
        after = page.page_info.end_cursor;

        if (!hasNextPage) {
          break;
        }

        await sleep(config.searchCycleTime);
        scanCycle += 1;

        if (scanCycle % 5 === 0) {
          if (activeTask !== null) {
            activeTask = {
              ...activeTask,
              isWaiting: true,
              message: `Waiting ${Math.round(config.searchCycleWait / 1000)}s between cycles...`,
            };
          }
          await sleep(config.searchCycleWait);
          if (activeTask !== null) {
            activeTask = {
              ...activeTask,
              isWaiting: false,
              message: "Resuming process...",
            };
          }
        }
      }

      if (activeTask !== null) {
        activeTask = {
          ...activeTask,
          progress: activeTask.total,
          message: "Complete!",
        };
      }
      window.setTimeout(() => {
        activeTask = null;
      }, 1000);
    } catch (error) {
      console.error(error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to scan Instagram";

      if (
        errorMessage.includes("cookie not found") ||
        errorMessage.includes("Missing Instagram tab")
      ) {
        needsCookieAuth = true;
        activeTask = null;
        return;
      }

      activeTask = {
        type: "scan",
        progress: 0,
        total: 1,
        message: errorMessage,
      };
    }
  }

  function updateWhitelist(nextWhitelist: readonly AppUser[]) {
    const normalizedWhitelist = nextWhitelist.map((user) => ({
      ...user,
      isWhitelisted: true,
    }));
    const whitelistIds = new Set(normalizedWhitelist.map((user) => user.id));

    whitelistedUsers = normalizedWhitelist;
    void saveStoredWhitelistedUsers(normalizedWhitelist);
    users = users.map((user) => ({
      ...user,
      isWhitelisted: whitelistIds.has(user.id),
    }));
  }

  function updateConfig(key: keyof TimingsConfig, value: number) {
    config = {
      ...config,
      [key]: value,
    };
    saveTimingsConfig(config);
  }

  async function handleExport(format: "csv" | "json") {
    const data = filteredUsers;
    showExportMenu = false;

    if (format === "json") {
      await downloadTextFile(
        "unfollowers.json",
        JSON.stringify(data, null, 2),
        "application/json",
      );
    } else {
      const csv = [
        ["ID", "Handle", "Name", "Status", "Whitelisted", "Verified", "Private"].join(","),
        ...data.map((user) =>
          [
            user.id,
            user.handle,
            user.name,
            user.status,
            user.isWhitelisted,
            user.isVerified,
            user.isPrivate,
          ].join(","),
        ),
      ].join("\n");
      await downloadTextFile("unfollowers.csv", csv, "text/csv");
    }
  }

  async function handleCopyList() {
    showExportMenu = false;
    const list = filteredUsers.map((user) => `@${user.handle}`).join("\n");
    await copyText(list);
  }

  async function openInstagramProfile(handle: string) {
    await openExternalUrl(`https://www.instagram.com/${handle}/`);
  }

  async function startBulkUnfollow(userIds = [...selectedUsers]) {
    if (instagramTabId === null) {
      alert("Open Unfollowers from an Instagram tab before unfollowing.");
      return;
    }

    const usersToUnfollow = users.filter((user) => userIds.includes(user.id));
    if (usersToUnfollow.length === 0) {
      return;
    }

    activeTask = {
      type: "unfollow",
      progress: 0,
      total: usersToUnfollow.length,
      message: "Preparing to unfollow...",
    };

    const successfulUnfollows = new Set<string>();
    let failedCount = 0;
    let lastFailureMessage = "";
    let processedCount = 0;

    for (const user of usersToUnfollow) {
      try {
        await unfollowInstagramUser(instagramTabId, user.id, user.handle);
        successfulUnfollows.add(user.id);
      } catch (error) {
        failedCount += 1;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        lastFailureMessage = `${user.handle}: ${errorMessage}`;
        console.error(error);
      }

      processedCount += 1;
      activeTask = {
        type: "unfollow",
        progress: processedCount,
        total: usersToUnfollow.length,
        message: `Unfollowing ${processedCount} of ${usersToUnfollow.length}...`,
      };

      if (processedCount === usersToUnfollow.length) {
        break;
      }

      await sleep(config.unfollowTime);

      if (processedCount % 5 === 0) {
        activeTask = {
          type: "unfollow",
          progress: processedCount,
          total: usersToUnfollow.length,
          message: `Waiting ${Math.round(config.unfollowWait / 1000)}s to avoid temporary ban...`,
          isWaiting: true,
        };
        await sleep(config.unfollowWait);
      }
    }

    users = users.filter((user) => !successfulUnfollows.has(user.id));
    selectedUsers = new Set();
    if (activeTask !== null) {
      activeTask = {
        ...activeTask,
        progress: activeTask.total,
        message:
          failedCount === 0
            ? "Complete!"
            : `${successfulUnfollows.size} unfollowed, ${failedCount} failed${lastFailureMessage === "" ? "" : ` - ${lastFailureMessage.slice(0, 110)}`}`,
        isWaiting: false,
      };
    }
    window.setTimeout(() => {
      activeTask = null;
    }, failedCount === 0 ? 1000 : 4000);
  }

  function toggleWhitelist(user: AppUser) {
    if (user.isWhitelisted) {
      updateWhitelist(whitelistedUsers.filter((entry) => entry.id !== user.id));
      return;
    }

    updateWhitelist([...whitelistedUsers, { ...user, isWhitelisted: true }]);
  }

  function toggleUser(id: string) {
    const next = new Set(selectedUsers);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selectedUsers = next;
  }

  function toggleAll() {
    if (selectedUsers.size === filteredUsers.length && filteredUsers.length > 0) {
      selectedUsers = new Set();
    } else {
      selectedUsers = new Set(filteredUsers.map((user) => user.id));
    }
  }

  function selectedForWhitelist() {
    const selected = users.filter((user) => selectedUsers.has(user.id));
    updateWhitelist([...whitelistedUsers, ...selected]);
    selectedUsers = new Set();
  }

  function toggleExportMenu() {
    showExportMenu = !showExportMenu;
    if (showExportMenu) {
      window.requestAnimationFrame(updateExportMenuPosition);
    }
  }

  function updateExportMenuPosition() {
    const button = exportButtonElement;
    if (button === null) {
      return;
    }

    const rect = button.getBoundingClientRect();
    exportMenuStyle = [
      `top: ${rect.bottom + 4}px`,
      `right: ${window.innerWidth - rect.right}px`,
    ].join("; ");
  }

  function updateTabIndicator() {
    const container = tabContainerElement;
    const button = tabButtonElements.get(filter);
    if (container === null || button === undefined || showSettings) {
      return;
    }

    tabTarget.left = button.offsetLeft;
    tabTarget.top = button.offsetTop;
    tabTarget.width = button.offsetWidth;
    tabTarget.height = button.offsetHeight;

    if (!tabSpringInitialized) {
      tabRect.left = tabTarget.left;
      tabRect.top = tabTarget.top;
      tabRect.width = tabTarget.width;
      tabRect.height = tabTarget.height;
      tabSpringInitialized = true;
      renderTabIndicator();
      return;
    }

    tabSpringLastTime = performance.now();
    if (tabSpringFrame === 0) {
      tabSpringFrame = window.requestAnimationFrame(stepTabSpring);
    }
  }

  function renderTabIndicator() {
    tabIndicatorStyle = [
      `left: ${tabRect.left}px`,
      `top: ${tabRect.top}px`,
      `width: ${tabRect.width}px`,
      `height: ${tabRect.height}px`,
    ].join("; ");
  }

  function stepTabSpring(time: number) {
    const dt = Math.min((time - tabSpringLastTime) / 1000, 0.032);
    tabSpringLastTime = time;

    let moving = false;
    for (const key of ["left", "top", "width", "height"] as const) {
      const displacement = tabTarget[key] - tabRect[key];
      const spring = displacement * 400;
      const damper = tabVelocity[key] * 25;
      const acceleration = spring - damper;

      tabVelocity[key] += acceleration * dt;
      tabRect[key] += tabVelocity[key] * dt;

      if (Math.abs(displacement) > 0.01 || Math.abs(tabVelocity[key]) > 0.01) {
        moving = true;
      } else {
        tabRect[key] = tabTarget[key];
        tabVelocity[key] = 0;
      }
    }

    renderTabIndicator();

    if (moving) {
      tabSpringFrame = window.requestAnimationFrame(stepTabSpring);
    } else {
      tabSpringFrame = 0;
    }
  }

  function setTabButton(node: HTMLButtonElement, tab: Filter) {
    tabButtonElements.set(tab, node);
    window.requestAnimationFrame(updateTabIndicator);

    return {
      destroy() {
        tabButtonElements.delete(tab);
      },
    };
  }

  function motionScale(
    node: HTMLElement,
    options: { hover?: number; tap?: number },
  ) {
    let hovered = false;
    let pressed = false;
    let currentScale = 1;
    let animation: Animation | null = null;

    const targetScale = () =>
      pressed ? (options.tap ?? 1) : hovered ? (options.hover ?? 1) : 1;

    const animateTo = (scale: number) => {
      if (currentScale === scale) {
        return;
      }

      animation?.cancel();
      animation = node.animate(
        [
          { transform: `scale(${currentScale})` },
          { transform: `scale(${scale})` },
        ],
        {
          duration: pressed ? 90 : 140,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          fill: "forwards",
        },
      );
      currentScale = scale;
    };

    const sync = () => animateTo(targetScale());

    const handlePointerEnter = () => {
      hovered = true;
      sync();
    };

    const handlePointerLeave = () => {
      hovered = false;
      pressed = false;
      sync();
    };

    const handlePointerDown = (event: PointerEvent) => {
      pressed = true;
      try {
        node.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is unavailable for some synthetic events.
      }
      sync();
    };

    const handlePointerUp = () => {
      pressed = false;
      sync();
    };

    node.addEventListener("pointerenter", handlePointerEnter);
    node.addEventListener("pointerleave", handlePointerLeave);
    node.addEventListener("pointerdown", handlePointerDown);
    node.addEventListener("pointerup", handlePointerUp);
    node.addEventListener("pointercancel", handlePointerUp);
    node.addEventListener("lostpointercapture", handlePointerUp);

    return {
      destroy() {
        animation?.cancel();
        node.removeEventListener("pointerenter", handlePointerEnter);
        node.removeEventListener("pointerleave", handlePointerLeave);
        node.removeEventListener("pointerdown", handlePointerDown);
        node.removeEventListener("pointerup", handlePointerUp);
        node.removeEventListener("pointercancel", handlePointerUp);
        node.removeEventListener("lostpointercapture", handlePointerUp);
      },
    };
  }

  function instagramLogoMotion(node: HTMLElement) {
    const value = {
      rotate: -3,
      scale: 1,
      y: 0,
    };
    const velocity = {
      rotate: 0,
      scale: 0,
      y: 0,
    };
    let target = {
      rotate: -3,
      scale: 1,
      y: 0,
    };
    let frame = 0;
    let lastTime = performance.now();

    const render = () => {
      node.style.transform = `rotate(${value.rotate}deg) scale(${value.scale}) translateY(${value.y}px)`;
    };

    const step = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.032);
      lastTime = time;

      let moving = false;
      for (const key of ["rotate", "scale", "y"] as const) {
        const displacement = target[key] - value[key];
        const spring = displacement * 400;
        const damper = velocity[key] * 10;
        const acceleration = spring - damper;

        velocity[key] += acceleration * dt;
        value[key] += velocity[key] * dt;

        if (Math.abs(displacement) > 0.001 || Math.abs(velocity[key]) > 0.001) {
          moving = true;
        } else {
          value[key] = target[key];
          velocity[key] = 0;
        }
      }

      render();

      if (moving) {
        frame = window.requestAnimationFrame(step);
      } else {
        frame = 0;
      }
    };

    const animateTo = (next: typeof target) => {
      target = next;
      lastTime = performance.now();
      if (frame === 0) {
        frame = window.requestAnimationFrame(step);
      }
    };

    const handlePointerEnter = () => {
      animateTo({ rotate: 4, scale: 1.1, y: -2 });
    };

    const handlePointerLeave = () => {
      animateTo({ rotate: -3, scale: 1, y: 0 });
    };

    render();
    node.addEventListener("pointerenter", handlePointerEnter);
    node.addEventListener("pointerleave", handlePointerLeave);

    return {
      destroy() {
        if (frame !== 0) {
          window.cancelAnimationFrame(frame);
        }
        node.removeEventListener("pointerenter", handlePointerEnter);
        node.removeEventListener("pointerleave", handlePointerLeave);
      },
    };
  }

  function iconKey(value: unknown) {
    return String(value);
  }

  function tabButton(node: HTMLButtonElement, tab: Filter) {
    return setTabButton(node, tab);
  }

  function tap92(node: HTMLElement) {
    return motionScale(node, { tap: 0.92 });
  }

  function tap96(node: HTMLElement) {
    return motionScale(node, { tap: 0.96 });
  }

  function openInstagramMotion(node: HTMLElement) {
    return motionScale(node, { hover: 1.02, tap: 0.98 });
  }

  function logoMotion(node: HTMLElement) {
    return instagramLogoMotion(node);
  }

  function activeIconKey(value: unknown) {
    return iconKey(value);
  }

  function markAvatarBroken(userId: string) {
    brokenAvatarIds = new Set([...brokenAvatarIds, userId]);
  }

  function shouldShowAvatar(user: AppUser) {
    return user.avatar !== "" && !brokenAvatarIds.has(user.id);
  }

  function cubicEase(t: number) {
    return 1 - Math.pow(1 - t, 3);
  }

  function sectionIn(_node: Element) {
    return {
      duration: 400,
      easing: cubicEase,
      css: (t: number, u: number) =>
        `opacity: ${t}; transform: translateY(${u * 14}px);`,
    };
  }

  function sectionOut(_node: Element) {
    return {
      duration: 400,
      easing: cubicEase,
      css: (t: number, u: number) =>
        `opacity: ${t}; transform: translateY(${-u * 14}px);`,
    };
  }

  function dropdownTransition(_node: Element) {
    return {
      duration: 100,
      easing: cubicEase,
      css: (t: number) => `opacity: ${t}; transform: scale(${0.95 + t * 0.05});`,
    };
  }

  function floatingTransition(_node: Element) {
    return {
      duration: 260,
      easing: cubicEase,
      css: (t: number, u: number) =>
        `opacity: ${t}; transform: translateX(-50%) translateY(${u * 50}px) scale(${0.95 + t * 0.05});`,
    };
  }

  function taskTransition(_node: Element) {
    return {
      duration: 180,
      easing: cubicEase,
      css: (t: number, u: number) =>
        `opacity: ${t}; transform: translateY(${-50 * u}px);`,
    };
  }
</script>

<div class="relative isolate flex flex-1 min-h-dvh flex-col">
  <main
    class="mx-auto w-full max-w-2xl sm:border-x border-dotted px-4 sm:px-8 pt-16 pb-16 flex flex-1 flex-col gap-12 border-border"
  >
    {#if needsCookieAuth}
      <div
        class="motion-auth flex flex-col items-center justify-center min-h-[50vh] text-center space-y-6"
      >
        <div class="motion-auth-icon p-4 bg-muted/50 rounded-2xl select-none">
          <img
            src="/instagram.svg"
            alt="Instagram"
            width="54"
            height="54"
            class="drop-shadow-sm rounded-[12px]"
          />
        </div>

        <div class="space-y-2 max-w-sm px-4">
          <h2 class="text-xl sm:text-2xl font-semibold tracking-tight">
            Instagram Required
          </h2>
          <p class="text-muted-foreground text-sm sm:text-base leading-relaxed">
            Please open this extension while on <strong>Instagram.com</strong> so we
            can securely access your session cookie.
          </p>
        </div>

        <div class="flex flex-col sm:flex-row items-center gap-3 pt-2">
          <button
            type="button"
            style="background: linear-gradient(180deg, #201E25 0%, #323137 100%); box-shadow: 0px 2px 4px rgba(0,0,0,0.1), 0px 0px 0px 1px #0D0D0D, inset 0px 1px 0px rgba(75, 73, 81, 0.8), inset 0px -1px 0px rgba(49, 48, 54, 0.8);"
            class="motion-control text-[#E0E0E0] h-10 px-6 flex items-center justify-center gap-2 rounded-[10px] font-medium text-sm w-full sm:w-auto"
            use:openInstagramMotion
            onclick={() => void openExternalUrl("https://www.instagram.com/")}
          >
            Open Instagram <ArrowUpRight class="w-4 h-4 ml-1 opacity-70" />
          </button>
        </div>
      </div>
    {:else}
      <section class="hero">
        <div class="motion-rise flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <div use:logoMotion>
              <img
                src="/instagram.svg"
                alt="Instagram"
                width="28"
                height="28"
                class="drop-shadow-md rounded-[6px]"
              />
            </div>
            <h1 class="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
              Unfollowers
            </h1>
          </div>

          <div class="flex items-center gap-2">
            <div class="relative">
              <button
                type="button"
                bind:this={exportButtonElement}
                class="motion-control relative p-2 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground outline-none"
                aria-label="Export"
                aria-expanded={showExportMenu}
                use:tap92
                onclick={() => {
                  toggleExportMenu();
                }}
              >
                <Download class="h-4 w-4" />
              </button>

            </div>

            <button
              type="button"
              onclick={toggleSettings}
              class="motion-control relative p-2 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground outline-none flex items-center justify-center"
              aria-label="Toggle settings"
              use:tap92
            >
              {#key activeIconKey(showSettings)}
                <span class="icon-swap">
                  {#if showSettings}
                    <X class="h-4 w-4" />
                  {:else}
                    <Settings class="h-4 w-4" />
                  {/if}
                </span>
              {/key}
            </button>

            <button
              type="button"
              onclick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              class="motion-control relative p-2 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground outline-none flex items-center justify-center"
              aria-label="Toggle dark mode"
              use:tap92
            >
              {#key activeIconKey(resolvedTheme)}
                <span class="icon-swap">
                  {#if resolvedTheme === "dark"}
                    <Moon class="h-4 w-4" />
                  {:else}
                    <Sun class="h-4 w-4" />
                  {/if}
                </span>
              {/key}
            </button>
          </div>
        </div>
      </section>

      {#if renderedPanel === "settings"}
        <section in:sectionIn out:sectionOut class="flex flex-col gap-8">
          <div class="flex items-center gap-3">
            <h2 class="text-lg font-semibold tracking-tight text-foreground">
              Configuration
            </h2>
          </div>

          <div class="grid gap-8 sm:grid-cols-2">
            <div class="space-y-4">
              <div
                class="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground border-b border-dashed border-border pb-2"
              >
                <Search class="h-3 w-3" />
                <span>Scanning Engine</span>
              </div>
              <div class="grid gap-4">
                <div class="grid gap-2">
                  <label
                    for="search-cycle-time"
                    class="text-xs font-medium text-muted-foreground uppercase tracking-tight"
                  >
                    Cycle Interval (ms)
                  </label>
                  <input
                    id="search-cycle-time"
                    data-slot="input"
                    type="number"
                    value={config.searchCycleTime}
                    oninput={(event) =>
                      updateConfig(
                        "searchCycleTime",
                        Number((event.currentTarget as HTMLInputElement).value),
                      )}
                    class={cn(
                      inputClass,
                      "bg-muted/5 border-dashed focus-visible:ring-1 focus-visible:ring-border h-9",
                    )}
                  />
                </div>
                <div class="grid gap-2">
                  <label
                    for="search-cycle-wait"
                    class="text-xs font-medium text-muted-foreground uppercase tracking-tight"
                  >
                    Cool-down (ms)
                  </label>
                  <input
                    id="search-cycle-wait"
                    data-slot="input"
                    type="number"
                    value={config.searchCycleWait}
                    oninput={(event) =>
                      updateConfig(
                        "searchCycleWait",
                        Number((event.currentTarget as HTMLInputElement).value),
                      )}
                    class={cn(
                      inputClass,
                      "bg-muted/5 border-dashed focus-visible:ring-1 focus-visible:ring-border h-9",
                    )}
                  />
                </div>
              </div>
            </div>

            <div class="space-y-4">
              <div
                class="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground border-b border-dashed border-border pb-2"
              >
                <RefreshCw class="h-3 w-3" />
                <span>Unfollow Logic</span>
              </div>
              <div class="grid gap-4">
                <div class="grid gap-2">
                  <label
                    for="unfollow-time"
                    class="text-xs font-medium text-muted-foreground uppercase tracking-tight"
                  >
                    Action Delay (ms)
                  </label>
                  <input
                    id="unfollow-time"
                    data-slot="input"
                    type="number"
                    value={config.unfollowTime}
                    oninput={(event) =>
                      updateConfig(
                        "unfollowTime",
                        Number((event.currentTarget as HTMLInputElement).value),
                      )}
                    class={cn(
                      inputClass,
                      "bg-muted/5 border-dashed focus-visible:ring-1 focus-visible:ring-border h-9",
                    )}
                  />
                </div>
                <div class="grid gap-2">
                  <label
                    for="unfollow-wait"
                    class="text-xs font-medium text-muted-foreground uppercase tracking-tight"
                  >
                    Safety Pause (ms)
                  </label>
                  <input
                    id="unfollow-wait"
                    data-slot="input"
                    type="number"
                    value={config.unfollowWait}
                    oninput={(event) =>
                      updateConfig(
                        "unfollowWait",
                        Number((event.currentTarget as HTMLInputElement).value),
                      )}
                    class={cn(
                      inputClass,
                      "bg-muted/5 border-dashed focus-visible:ring-1 focus-visible:ring-border h-9",
                    )}
                  />
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onclick={() => void openExternalUrl("https://judekim.com/")}
            class="self-start text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          >
            built with svelte by jude kim
          </button>
        </section>
      {:else if renderedPanel === "main"}
        <section in:sectionIn out:sectionOut class="flex flex-col gap-4 -mt-6">
          <div
            class="motion-rise-delay-1 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between"
          >
            <div class="relative w-full flex-1 sm:max-w-[240px]">
              <Search class="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                data-slot="input"
                placeholder="Search accounts..."
                value={searchTerm}
                oninput={(event) => {
                  searchTerm = (event.currentTarget as HTMLInputElement).value;
                }}
                class={cn(
                  inputClass,
                  "pl-9 bg-transparent border-dashed focus-visible:ring-1 focus-visible:ring-border h-9 text-sm rounded-md",
                )}
              />
            </div>

            <div
              bind:this={tabContainerElement}
              class="relative flex items-center p-1 gap-1 rounded-md border border-dashed bg-muted/10 w-full sm:w-auto overflow-x-auto scrollbar-hide"
            >
              <div
                class="tab-active-indicator absolute bg-muted/50 rounded-sm border border-border/50"
                style={tabIndicatorStyle}
              ></div>
              {#each TABS as tab (tab.id)}
                <button
                  type="button"
                  use:tabButton={tab.id}
                  onclick={() => {
                    filter = tab.id;
                  }}
                  use:tap96
                  class={cn(
                    "motion-control relative z-10 flex-1 sm:flex-none px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors whitespace-nowrap outline-none",
                    filter === tab.id
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span class="relative z-10">{tab.label}</span>
                </button>
              {/each}
            </div>
          </div>

          <div
            class="motion-rise-delay-2 flex flex-col border border-dashed rounded-lg divide-y divide-dashed overflow-hidden"
          >
            <div class="flex items-center justify-between px-4 py-3 bg-muted/20">
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  id="select-all"
                  role="checkbox"
                  aria-checked={selectedUsers.size === filteredUsers.length &&
                    filteredUsers.length > 0}
                  data-state={selectedUsers.size === filteredUsers.length &&
                  filteredUsers.length > 0
                    ? "checked"
                    : "unchecked"}
                  data-checked={selectedUsers.size === filteredUsers.length &&
                  filteredUsers.length > 0
                    ? true
                    : undefined}
                  onclick={toggleAll}
                  class={cn(
                    checkboxClass,
                    "h-4 w-4 rounded-sm border-muted-foreground/50 data-[state=checked]:bg-foreground data-[state=checked]:text-background",
                  )}
                >
                  {#if selectedUsers.size === filteredUsers.length && filteredUsers.length > 0}
                    <span
                      data-slot="checkbox-indicator"
                      class="grid place-content-center text-current transition-none [&>svg]:size-3.5"
                    >
                      <Check />
                    </span>
                  {/if}
                </button>
                <label
                  for="select-all"
                  class="text-xs font-mono uppercase tracking-wider text-muted-foreground cursor-pointer select-none"
                >
                  Select All
                </label>
              </div>
              <div class="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                {filteredUsers.length} Users
              </div>
            </div>

            <div class="flex flex-col">
              {#each filteredUsers as user (user.id)}
                <div
                  role="button"
                  tabindex="0"
                  onclick={() => toggleUser(user.id)}
                  onkeydown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleUser(user.id);
                    }
                  }}
                  class="flex items-center justify-between p-4 hover:bg-muted/10 transition-colors group cursor-pointer"
                >
                  <div class="flex items-center gap-4">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={selectedUsers.has(user.id)}
                      data-state={selectedUsers.has(user.id) ? "checked" : "unchecked"}
                      data-checked={selectedUsers.has(user.id) ? true : undefined}
                      onclick={(event) => {
                        event.stopPropagation();
                        toggleUser(user.id);
                      }}
                      class={cn(
                        checkboxClass,
                        "h-4 w-4 rounded-sm border-muted-foreground/50 data-[state=checked]:bg-foreground data-[state=checked]:text-background",
                      )}
                    >
                      {#if selectedUsers.has(user.id)}
                        <span
                          data-slot="checkbox-indicator"
                          class="grid place-content-center text-current transition-none [&>svg]:size-3.5"
                        >
                          <Check />
                        </span>
                      {/if}
                    </button>
                    <a
                      href={`https://instagram.com/${user.handle}`}
                      target="_blank"
                      rel="noreferrer"
                      onclick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void openInstagramProfile(user.handle);
                      }}
                      class="flex items-center gap-3 hover:opacity-80 transition-opacity"
                    >
                      <div
                        data-slot="avatar"
                        data-size="default"
                        class={cn(avatarClass, "h-9 w-9 border border-border")}
                      >
                        {#if shouldShowAvatar(user)}
                          <img
                            data-slot="avatar-image"
                            src={user.avatar}
                            alt=""
                            onerror={() => markAvatarBroken(user.id)}
                            class="aspect-square size-full rounded-full object-cover"
                          />
                        {:else}
                          <span
                            data-slot="avatar-fallback"
                            class="flex size-full items-center justify-center rounded-full text-xs font-mono bg-muted text-muted-foreground"
                          >
                            {user.handle.slice(0, 2).toUpperCase()}
                          </span>
                        {/if}
                      </div>
                      <div class="flex flex-col">
                        <div class="flex items-center gap-1.5">
                          <span class="text-sm font-medium text-foreground tracking-tight">
                            {user.handle}
                          </span>
                          {#if user.isVerified}
                            <svg
                              aria-label="Verified"
                              fill="rgb(0, 149, 246)"
                              height="14"
                              role="img"
                              viewBox="0 0 40 40"
                              width="14"
                              class="shrink-0"
                            >
                              <title>Verified</title>
                              <path
                                d="M19.998 3.094 14.638 0l-2.972 5.15H5.432v6.354L0 14.64 3.094 20 0 25.359l5.432 3.137v5.905h5.975L14.638 40l5.36-3.094L25.358 40l3.232-5.6h6.162v-6.01L40 25.359 36.905 20 40 14.641l-5.248-3.03v-6.46h-6.419L25.358 0l-5.36 3.094Zm7.415 11.225 2.254 2.287-11.43 11.5-6.835-6.93 2.244-2.258 4.587 4.581 9.18-9.18Z"
                                fill-rule="evenodd"
                              ></path>
                            </svg>
                          {/if}
                          {#if user.isWhitelisted}
                            <ShieldCheck class="h-3 w-3 text-muted-foreground ml-0.5" />
                          {/if}
                          {#if user.isPrivate}
                            <Lock class="h-3 w-3 text-muted-foreground ml-0.5" />
                          {/if}
                        </div>
                        <span class="text-xs text-muted-foreground">
                          {user.name}
                        </span>
                      </div>
                    </a>
                  </div>

                  <div class="flex items-center gap-3">
                    <button
                      type="button"
                      onclick={(event) => {
                        event.stopPropagation();
                        toggleWhitelist(user);
                      }}
                      class="text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors hidden sm:block"
                    >
                      {user.isWhitelisted ? "Unwhitelist" : "Whitelist"}
                    </button>
                    {#if !user.isWhitelisted}
                      <button
                        type="button"
                        onclick={(event) => {
                          event.stopPropagation();
                          void startBulkUnfollow([user.id]);
                        }}
                        class="text-xs font-mono uppercase tracking-wider text-destructive hover:text-destructive/80 transition-colors"
                      >
                        Unfollow
                      </button>
                    {/if}
                    <a
                      href={`https://instagram.com/${user.handle}`}
                      target="_blank"
                      rel="noreferrer"
                      onclick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void openInstagramProfile(user.handle);
                      }}
                      class="text-muted-foreground hover:text-foreground transition-colors p-2.5 -m-2.5"
                    >
                      <ArrowUpRight class="h-4 w-4" />
                    </a>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </section>
      {/if}

      {#if showExportMenu}
        <div
          bind:this={exportMenuElement}
          data-slot="dropdown-menu-content"
          transition:dropdownTransition
          style={exportMenuStyle}
          class="dropdown-content fixed z-[1000] max-h-(--available-height) w-(--anchor-width) min-w-[140px] origin-top-right overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none"
        >
          <button
            type="button"
            data-slot="dropdown-menu-item"
            class={dropdownItemClass}
            onclick={() => void handleCopyList()}
          >
            <Copy class="mr-2 h-4 w-4" />
            <span>Copy List</span>
          </button>
          <button
            type="button"
            data-slot="dropdown-menu-item"
            class={dropdownItemClass}
            onclick={() => void handleExport("csv")}
          >
            <Download class="mr-2 h-4 w-4" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            data-slot="dropdown-menu-item"
            class={dropdownItemClass}
            onclick={() => void handleExport("json")}
          >
            <Download class="mr-2 h-4 w-4" />
            <span>Export JSON</span>
          </button>
        </div>
      {/if}

      {#if selectedUsers.size > 0 && !showSettings}
        <div
          transition:floatingTransition
          class="fixed bottom-8 left-1/2 flex items-center gap-1 p-1.5 bg-muted/80 backdrop-blur-xl text-foreground rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-border z-50"
          style="transform: translateX(-50%);"
        >
          <div class="flex items-center gap-2 px-3 py-1.5">
            <span
              class="flex items-center justify-center bg-foreground text-background rounded-md h-5 min-w-[20px] px-1.5 text-xs font-mono font-medium"
            >
              {selectedUsers.size}
            </span>
            <span class="text-sm font-medium text-muted-foreground hidden sm:inline-block">
              selected
            </span>
          </div>

          <div class="h-5 w-px bg-border/50 mx-1"></div>

          <button
            type="button"
            onclick={selectedForWhitelist}
            class="px-3 py-1.5 rounded-md hover:bg-background/80 transition-colors font-mono uppercase tracking-wider text-xs whitespace-nowrap text-foreground"
          >
            Whitelist
          </button>

          <button
            type="button"
            onclick={() => void startBulkUnfollow()}
            class="px-3 py-1.5 rounded-md hover:bg-destructive/10 transition-colors text-destructive font-mono uppercase tracking-wider text-xs whitespace-nowrap"
          >
            Unfollow
          </button>

          <div class="h-5 w-px bg-border/50 mx-1"></div>

          <button
            type="button"
            onclick={() => {
              selectedUsers = new Set();
            }}
            class="p-1.5 rounded-md text-muted-foreground hover:bg-background/80 hover:text-foreground transition-colors"
            aria-label="Clear selection"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
      {/if}

      {#if activeTask}
        <div
          transition:taskTransition
          class="fixed top-0 left-0 right-0 z-[100] flex flex-col items-center pointer-events-none"
        >
          <div class="w-full max-w-2xl overflow-hidden h-12">
            <div
              class="h-full flex flex-col"
              style={`transform-origin: 0 50%; transform: scaleX(${activeTask.progress / activeTask.total}); transition: transform 0.2s linear;`}
            >
              <div class="h-[1px] w-full bg-foreground/30 dark:bg-foreground/50"></div>
              <div
                class="flex-1 w-full bg-gradient-to-b from-foreground/[0.08] dark:from-foreground/[0.15] via-foreground/[0.01] dark:via-foreground/[0.04] to-transparent"
              ></div>
            </div>
          </div>

          <div class="flex justify-center -mt-6 pointer-events-auto">
            <div
              class="bg-background/80 backdrop-blur-md border border-border px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2"
            >
              {#if activeTask.progress < activeTask.total}
                <Loader2 class="h-3 w-3 animate-spin text-muted-foreground" />
              {:else}
                <ShieldCheck class="h-3 w-3 text-emerald-500" />
              {/if}
              <span
                class="text-xs font-mono font-medium whitespace-nowrap tabular-nums min-w-[9.5rem] text-center"
              >
                {activeTask.message ||
                  `${activeTask.type === "scan" ? "Scanning" : "Unfollowing"} ${activeTask.progress}/${activeTask.total}`}
              </span>
              {#if activeTask.isWaiting}
                <div class="w-px h-3 bg-border"></div>
                <span
                  class="text-[10px] text-amber-500 font-medium flex items-center gap-1"
                >
                  <Timer class="h-3 w-3 animate-pulse" /> Rate limit pause
                </span>
              {/if}
            </div>
          </div>
        </div>
      {/if}
    {/if}
  </main>
</div>
