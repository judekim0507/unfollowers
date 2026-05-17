"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ShieldCheck,
  ArrowUpRight,
  Lock,
  Search,
  Moon,
  Sun,
  X,
  Loader2,
  Timer,
  RefreshCw,
  Settings,
  Download,
  Copy,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import {
  AppUser,
  copyText,
  downloadTextFile,
  fetchFollowingPage,
  getInstagramTabId,
  loadTimingsConfig,
  loadStoredWhitelistedUsers,
  openExternalUrl,
  saveTimingsConfig,
  saveStoredWhitelistedUsers,
  sleep,
  toAppUser,
  unfollowInstagramUser,
} from "@/lib/instagram-bridge";

const EASE = [0.16, 1, 0.3, 1] as const;

export default function Home() {
  const instagramTabId = useMemo(() => getInstagramTabId(), []);
  const scanStartedRef = useRef(false);
  const [needsCookieAuth, setNeedsCookieAuth] = useState(
    () => instagramTabId === null,
  );
  const [users, setUsers] = useState<AppUser[]>([]);
  const [whitelistedUsers, setWhitelistedUsers] = useState<readonly AppUser[]>(
    [],
  );
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "unfollowed" | "whitelisted">(
    "unfollowed",
  );
  const [searchTerm, setSearchTerm] = useState("");
  const { setTheme, resolvedTheme } = useTheme();
  const [showSettings, setShowSettings] = useState(false);

  const [config, setConfig] = useState(
    () =>
      loadTimingsConfig() ?? {
    searchCycleTime: 200,
    searchCycleWait: 2000,
    unfollowTime: 800,
    unfollowWait: 5000,
      },
  );
  const configRef = useRef(config);

  // Task state for long-running processes
  const [activeTask, setActiveTask] = useState<{
    type: "scan" | "unfollow";
    progress: number;
    total: number;
    message: string;
    isWaiting?: boolean;
  } | null>(null);

  useEffect(() => {
    configRef.current = config;
    saveTimingsConfig(config);
  }, [config]);

  useEffect(() => {
    if (resolvedTheme !== "dark" && resolvedTheme !== "light") {
      return;
    }

    const background =
      resolvedTheme === "dark" ? "oklch(0.145 0 0)" : "oklch(1 0 0)";

    document.documentElement.style.backgroundColor = background;
    document.body.style.backgroundColor = background;
    document.documentElement.style.colorScheme = resolvedTheme;
    window.parent.postMessage(
      {
        source: "unfollowers-theme",
        theme: resolvedTheme,
      },
      "*",
    );
  }, [resolvedTheme]);

  const updateWhitelist = (nextWhitelist: readonly AppUser[]) => {
    const normalizedWhitelist = nextWhitelist.map((user) => ({
      ...user,
      isWhitelisted: true,
    }));
    const whitelistIds = new Set(normalizedWhitelist.map((user) => user.id));

    setWhitelistedUsers(normalizedWhitelist);
    void saveStoredWhitelistedUsers(normalizedWhitelist);
    setUsers((currentUsers) =>
      currentUsers.map((user) => ({
        ...user,
        isWhitelisted: whitelistIds.has(user.id),
      })),
    );
  };

  useEffect(() => {
    if (scanStartedRef.current) {
      return;
    }

    scanStartedRef.current = true;

    const scanFollowing = async () => {
      if (instagramTabId === null) {
        setNeedsCookieAuth(true);
        return;
      }

      setNeedsCookieAuth(false);
      const storedWhitelist = await loadStoredWhitelistedUsers();
      const whitelistedIds = new Set(storedWhitelist.map((user) => user.id));
      setWhitelistedUsers(storedWhitelist);
      setUsers([]);
      setActiveTask({
        type: "scan",
        progress: 0,
        total: 1,
        message: "Initializing scan...",
      });

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

          setUsers(scannedUsers);
          setActiveTask({
            type: "scan",
            progress: Math.min(scannedCount, totalCount),
            total: totalCount,
            message: `Scanning account ${Math.min(scannedCount, totalCount)} of ${totalCount}...`,
          });

          hasNextPage = page.page_info.has_next_page;
          after = page.page_info.end_cursor;

          if (!hasNextPage) {
            break;
          }

          await sleep(configRef.current.searchCycleTime);
          scanCycle += 1;

          if (scanCycle % 5 === 0) {
            setActiveTask((task) =>
              task === null
                ? task
                : {
                    ...task,
                    isWaiting: true,
                    message: `Waiting ${Math.round(configRef.current.searchCycleWait / 1000)}s between cycles...`,
                  },
            );
            await sleep(configRef.current.searchCycleWait);
            setActiveTask((task) =>
              task === null
                ? task
                : {
                    ...task,
                    isWaiting: false,
                    message: "Resuming process...",
                  },
            );
          }
        }

        setActiveTask((task) =>
          task === null
            ? task
            : { ...task, progress: task.total, message: "Complete!" },
        );
        window.setTimeout(() => setActiveTask(null), 1000);
      } catch (error) {
        console.error(error);
        const errorMessage =
          error instanceof Error ? error.message : "Failed to scan Instagram";

        if (
          errorMessage.includes("cookie not found") ||
          errorMessage.includes("Missing Instagram tab")
        ) {
          setNeedsCookieAuth(true);
          setActiveTask(null);
          return;
        }

        setActiveTask({
          type: "scan",
          progress: 0,
          total: 1,
          message: errorMessage,
        });
      }
    };

    void scanFollowing();
  }, [instagramTabId]);

  const handleExport = async (format: "csv" | "json") => {
    const data = filteredUsers;
    if (format === "json") {
      await downloadTextFile(
        "unfollowers.json",
        JSON.stringify(data, null, 2),
        "application/json",
      );
    } else {
      const csv = [
        [
          "ID",
          "Handle",
          "Name",
          "Status",
          "Whitelisted",
          "Verified",
          "Private",
        ].join(","),
        ...data.map((u) =>
          [
            u.id,
            u.handle,
            u.name,
            u.status,
            u.isWhitelisted,
            u.isVerified,
            u.isPrivate,
          ].join(","),
        ),
      ].join("\n");
      await downloadTextFile("unfollowers.csv", csv, "text/csv");
    }
  };

  const handleCopyList = async () => {
    const list = filteredUsers.map((u) => `@${u.handle}`).join("\n");
    await copyText(list);
  };

  const openInstagramProfile = async (handle: string) => {
    await openExternalUrl(`https://www.instagram.com/${handle}/`);
  };

  const startBulkUnfollow = async (userIds = [...selectedUsers]) => {
    if (instagramTabId === null) {
      alert("Open Unfollowers from an Instagram tab before unfollowing.");
      return;
    }

    const usersToUnfollow = users.filter((user) => userIds.includes(user.id));
    if (usersToUnfollow.length === 0) {
      return;
    }

    setActiveTask({
      type: "unfollow",
      progress: 0,
      total: usersToUnfollow.length,
      message: "Preparing to unfollow...",
    });

    const successfulUnfollows = new Set<string>();
    let failedCount = 0;
    let processedCount = 0;

    for (const user of usersToUnfollow) {
      try {
        await unfollowInstagramUser(instagramTabId, user.id, user.handle);
        successfulUnfollows.add(user.id);
      } catch (error) {
        failedCount += 1;
        console.error(error);
      }

      processedCount += 1;
      setActiveTask({
        type: "unfollow",
        progress: processedCount,
        total: usersToUnfollow.length,
        message: `Unfollowing ${processedCount} of ${usersToUnfollow.length}...`,
      });

      if (processedCount === usersToUnfollow.length) {
        break;
      }

      await sleep(configRef.current.unfollowTime);

      if (processedCount % 5 === 0) {
        setActiveTask({
          type: "unfollow",
          progress: processedCount,
          total: usersToUnfollow.length,
          message: `Waiting ${Math.round(configRef.current.unfollowWait / 1000)}s to avoid temporary ban...`,
          isWaiting: true,
        });
        await sleep(configRef.current.unfollowWait);
      }
    }

    setUsers((currentUsers) =>
      currentUsers.filter((user) => !successfulUnfollows.has(user.id)),
    );
    setSelectedUsers(new Set());
    setActiveTask((task) =>
      task === null
        ? task
        : {
            ...task,
            progress: task.total,
            message:
              failedCount === 0
                ? "Complete!"
                : `${successfulUnfollows.size} unfollowed, ${failedCount} failed`,
            isWaiting: false,
          },
    );
    window.setTimeout(() => setActiveTask(null), failedCount === 0 ? 1000 : 4000);
  };

  const filteredUsers = users.filter((u) => {
    const matchesFilter =
      filter === "all"
        ? true
        : filter === "whitelisted"
          ? u.isWhitelisted
          : !u.isWhitelisted && !u.followsViewer;
    const matchesSearch =
      searchTerm === "" ||
      u.handle.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.name.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesFilter && matchesSearch;
  });

  const toggleWhitelist = (user: AppUser) => {
    if (user.isWhitelisted) {
      updateWhitelist(whitelistedUsers.filter((entry) => entry.id !== user.id));
      return;
    }

    updateWhitelist([...whitelistedUsers, { ...user, isWhitelisted: true }]);
  };

  const toggleUser = (id: string) => {
    const next = new Set(selectedUsers);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedUsers(next);
  };

  const toggleAll = () => {
    if (
      selectedUsers.size === filteredUsers.length &&
      filteredUsers.length > 0
    ) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(filteredUsers.map((u) => u.id)));
    }
  };

  const TABS = [
    { id: "unfollowed", label: "Unfollowed" },
    { id: "whitelisted", label: "Whitelisted" },
    { id: "all", label: "All" },
  ] as const;

  if (needsCookieAuth) {
    return (
      <motion.div 
        className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-6"
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <motion.div 
          className="p-4 bg-muted/50 rounded-2xl select-none"
          initial={{ rotate: -5, scale: 0.9 }}
          animate={{ rotate: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 12 }}
        >
          <Image
            src="/instagram.svg"
            alt="Instagram"
            width={54}
            height={54}
            className="drop-shadow-sm rounded-[12px]"
          />
        </motion.div>
        
        <div className="space-y-2 max-w-sm px-4">
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">Instagram Required</h2>
          <p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
            Please open this extension while on <strong>Instagram.com</strong> so we can securely access your session cookie.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
          <motion.button 
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            style={{
              background: 'linear-gradient(180deg, #201E25 0%, #323137 100%)',
              boxShadow: '0px 2px 4px rgba(0,0,0,0.1), 0px 0px 0px 1px #0D0D0D, inset 0px 1px 0px rgba(75, 73, 81, 0.8), inset 0px -1px 0px rgba(49, 48, 54, 0.8)',
            }}
            className="text-[#E0E0E0] h-10 px-6 flex items-center justify-center gap-2 rounded-[10px] font-medium text-sm w-full sm:w-auto"
            onClick={() => void openExternalUrl("https://www.instagram.com/")}
          >
            Open Instagram <ArrowUpRight className="w-4 h-4 ml-1 opacity-70" />
          </motion.button>
        </div>
      </motion.div>
    );
  }

  return (
    <>
      <section className="hero">
        <motion.div
          className="flex items-center justify-between"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <div className="flex items-center gap-2.5">
            <motion.div
              initial={{ rotate: -3 }}
              whileHover={{ rotate: 4, scale: 1.1, y: -2 }}
              transition={{ type: "spring", stiffness: 400, damping: 10 }}
            >
              <Image
                src="/instagram.svg"
                alt="Instagram"
                width={28}
                height={28}
                className="drop-shadow-md rounded-[6px]"
              />
            </motion.div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
              Unfollowers
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <motion.button
                  whileTap={{ scale: 0.92 }}
                  className="relative p-2 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground outline-none"
                >
                  <Download className="h-4 w-4" />
                </motion.button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[140px]">
                <DropdownMenuItem onClick={() => void handleCopyList()}>
                  <Copy className="mr-2 h-4 w-4" />
                  <span>Copy List</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void handleExport("csv")}>
                  <Download className="mr-2 h-4 w-4" />
                  <span>Export CSV</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void handleExport("json")}>
                  <Download className="mr-2 h-4 w-4" />
                  <span>Export JSON</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => setShowSettings(!showSettings)}
              className="relative p-2 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground outline-none flex items-center justify-center"
              aria-label="Toggle settings"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={showSettings ? "close" : "settings"}
                  initial={{ opacity: 0, scale: 0.8, filter: "blur(4px)" }}
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, scale: 0.8, filter: "blur(4px)" }}
                  transition={{ duration: 0.15 }}
                >
                  {showSettings ? (
                    <X className="h-4 w-4" />
                  ) : (
                    <Settings className="h-4 w-4" />
                  )}
                </motion.div>
              </AnimatePresence>
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }
              className="relative p-2 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground outline-none flex items-center justify-center"
              aria-label="Toggle dark mode"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={resolvedTheme}
                  initial={{ opacity: 0, scale: 0.8, filter: "blur(4px)" }}
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, scale: 0.8, filter: "blur(4px)" }}
                  transition={{ duration: 0.15 }}
                >
                  {resolvedTheme === "dark" ? (
                    <Moon className="h-4 w-4" />
                  ) : (
                    <Sun className="h-4 w-4" />
                  )}
                </motion.div>
              </AnimatePresence>
            </motion.button>
          </div>
        </motion.div>
      </section>

      <AnimatePresence mode="wait">
        {showSettings ? (
          <motion.section
            key="settings"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="flex flex-col gap-8"
          >
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Configuration
              </h2>
            </div>

            <div className="grid gap-8 sm:grid-cols-2">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground border-b border-dashed border-border pb-2">
                  <Search className="h-3 w-3" />
                  <span>Scanning Engine</span>
                </div>
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-tight">
                      Cycle Interval (ms)
                    </label>
                    <Input
                      type="number"
                      value={config.searchCycleTime}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          searchCycleTime: Number(e.target.value),
                        })
                      }
                      className="bg-muted/5 border-dashed focus-visible:ring-1 focus-visible:ring-border h-9"
                    />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-tight">
                      Cool-down (ms)
                    </label>
                    <Input
                      type="number"
                      value={config.searchCycleWait}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          searchCycleWait: Number(e.target.value),
                        })
                      }
                      className="bg-muted/5 border-dashed focus-visible:ring-1 focus-visible:ring-border h-9"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground border-b border-dashed border-border pb-2">
                  <RefreshCw className="h-3 w-3" />
                  <span>Unfollow Logic</span>
                </div>
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-tight">
                      Action Delay (ms)
                    </label>
                    <Input
                      type="number"
                      value={config.unfollowTime}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          unfollowTime: Number(e.target.value),
                        })
                      }
                      className="bg-muted/5 border-dashed focus-visible:ring-1 focus-visible:ring-border h-9"
                    />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-tight">
                      Safety Pause (ms)
                    </label>
                    <Input
                      type="number"
                      value={config.unfollowWait}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          unfollowWait: Number(e.target.value),
                        })
                      }
                      className="bg-muted/5 border-dashed focus-visible:ring-1 focus-visible:ring-border h-9"
                    />
                  </div>
                </div>
              </div>
            </div>
          </motion.section>
        ) : (
          <motion.section
            key="main"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="flex flex-col gap-4 -mt-6"
          >
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12, duration: 0.6, ease: EASE }}
              className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between"
            >
              <div className="relative w-full flex-1 sm:max-w-[240px]">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search accounts..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 bg-transparent border-dashed focus-visible:ring-1 focus-visible:ring-border h-9 text-sm rounded-md"
                />
              </div>

              <div className="flex items-center p-1 gap-1 rounded-md border border-dashed bg-muted/10 w-full sm:w-auto overflow-x-auto scrollbar-hide">
                {TABS.map((tab) => (
                  <motion.button
                    key={tab.id}
                    onClick={() => setFilter(tab.id)}
                    whileTap={{ scale: 0.96 }}
                    className={cn(
                      "relative flex-1 sm:flex-none px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors whitespace-nowrap outline-none",
                      filter === tab.id
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {filter === tab.id && (
                      <motion.div
                        layoutId="active-tab"
                        className="absolute inset-0 bg-muted/50 rounded-sm border border-border/50"
                        transition={{
                          type: "spring",
                          stiffness: 400,
                          damping: 25,
                        }}
                      />
                    )}
                    <span className="relative z-10">{tab.label}</span>
                  </motion.button>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.6, ease: EASE }}
              className="flex flex-col border border-dashed rounded-lg divide-y divide-dashed overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 bg-muted/20">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="select-all"
                    checked={
                      selectedUsers.size === filteredUsers.length &&
                      filteredUsers.length > 0
                    }
                    onCheckedChange={toggleAll}
                    className="h-4 w-4 rounded-sm border-muted-foreground/50 data-[state=checked]:bg-foreground data-[state=checked]:text-background"
                  />
                  <label
                    htmlFor="select-all"
                    className="text-xs font-mono uppercase tracking-wider text-muted-foreground cursor-pointer select-none"
                  >
                    Select All
                  </label>
                </div>
                <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  {filteredUsers.length} Users
                </div>
              </div>

              <div className="flex flex-col">
                {filteredUsers.map((user) => (
                  <div
                    key={user.id}
                    onClick={() => toggleUser(user.id)}
                    className="flex items-center justify-between p-4 hover:bg-muted/10 transition-colors group cursor-pointer"
                  >
                    <div className="flex items-center gap-4">
                      <Checkbox
                        checked={selectedUsers.has(user.id)}
                        onCheckedChange={() => toggleUser(user.id)}
                        className="h-4 w-4 rounded-sm border-muted-foreground/50 data-[state=checked]:bg-foreground data-[state=checked]:text-background"
                      />
                      <a
                        href={`https://instagram.com/${user.handle}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void openInstagramProfile(user.handle);
                        }}
                        className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                      >
                        <Avatar className="h-9 w-9 border border-border">
                          <AvatarImage src={user.avatar} />
                          <AvatarFallback className="text-xs font-mono bg-muted text-muted-foreground">
                            {user.handle.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-foreground tracking-tight">
                              {user.handle}
                            </span>
                            {user.isVerified && (
                              <svg
                                aria-label="Verified"
                                fill="rgb(0, 149, 246)"
                                height="14"
                                role="img"
                                viewBox="0 0 40 40"
                                width="14"
                                className="shrink-0"
                              >
                                <title>Verified</title>
                                <path
                                  d="M19.998 3.094 14.638 0l-2.972 5.15H5.432v6.354L0 14.64 3.094 20 0 25.359l5.432 3.137v5.905h5.975L14.638 40l5.36-3.094L25.358 40l3.232-5.6h6.162v-6.01L40 25.359 36.905 20 40 14.641l-5.248-3.03v-6.46h-6.419L25.358 0l-5.36 3.094Zm7.415 11.225 2.254 2.287-11.43 11.5-6.835-6.93 2.244-2.258 4.587 4.581 9.18-9.18Z"
                                  fillRule="evenodd"
                                ></path>
                              </svg>
                            )}
                            {user.isWhitelisted && (
                              <ShieldCheck className="h-3 w-3 text-muted-foreground ml-0.5" />
                            )}
                            {user.isPrivate && (
                              <Lock className="h-3 w-3 text-muted-foreground ml-0.5" />
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {user.name}
                          </span>
                        </div>
                      </a>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleWhitelist(user);
                        }}
                        className="text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors hidden sm:block"
                      >
                        {user.isWhitelisted ? "Unwhitelist" : "Whitelist"}
                      </button>
                      {!user.isWhitelisted && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void startBulkUnfollow([user.id]);
                          }}
                          className="text-xs font-mono uppercase tracking-wider text-destructive hover:text-destructive/80 transition-colors"
                        >
                          Unfollow
                        </button>
                      )}
                      <a
                        href={`https://instagram.com/${user.handle}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void openInstagramProfile(user.handle);
                        }}
                        className="text-muted-foreground hover:text-foreground transition-colors p-2.5 -m-2.5"
                      >
                        <ArrowUpRight className="h-4 w-4" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Floating Action Bar */}
      <AnimatePresence>
        {selectedUsers.size > 0 && !showSettings && (
          <motion.div
            initial={{ y: 50, opacity: 0, x: "-50%", scale: 0.95 }}
            animate={{ y: 0, opacity: 1, x: "-50%", scale: 1 }}
            exit={{ y: 50, opacity: 0, x: "-50%", scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className="fixed bottom-8 left-1/2 flex items-center gap-1 p-1.5 bg-muted/80 backdrop-blur-xl text-foreground rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-border z-50"
          >
            <div className="flex items-center gap-2 px-3 py-1.5">
              <span className="flex items-center justify-center bg-foreground text-background rounded-md h-5 min-w-[20px] px-1.5 text-xs font-mono font-medium">
                {selectedUsers.size}
              </span>
              <span className="text-sm font-medium text-muted-foreground hidden sm:inline-block">
                selected
              </span>
            </div>

            <div className="h-5 w-px bg-border/50 mx-1" />

            <button
              onClick={() => {
                const selected = users.filter((user) =>
                  selectedUsers.has(user.id),
                );
                updateWhitelist([...whitelistedUsers, ...selected]);
                setSelectedUsers(new Set());
              }}
              className="px-3 py-1.5 rounded-md hover:bg-background/80 transition-colors font-mono uppercase tracking-wider text-xs whitespace-nowrap text-foreground"
            >
              Whitelist
            </button>

            <button
              onClick={() => void startBulkUnfollow()}
              className="px-3 py-1.5 rounded-md hover:bg-destructive/10 transition-colors text-destructive font-mono uppercase tracking-wider text-xs whitespace-nowrap"
            >
              Unfollow
            </button>

            <div className="h-5 w-px bg-border/50 mx-1" />

            <button
              onClick={() => setSelectedUsers(new Set())}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-background/80 hover:text-foreground transition-colors"
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Global Progress Bar for tasks */}
      <AnimatePresence>
        {activeTask && (
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="fixed top-0 left-0 right-0 z-[100] flex flex-col items-center pointer-events-none"
          >
            <div className="w-full max-w-2xl overflow-hidden h-12">
              <motion.div
                className="h-full flex flex-col"
                style={{ originX: 0 }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: activeTask.progress / activeTask.total }}
                transition={{ ease: "linear", duration: 0.2 }}
              >
                {/* Sharp 1px anchor line for definition */}
                <div className="h-[1px] w-full bg-foreground/30 dark:bg-foreground/50" />
                {/* Multi-stop eased gradient for a buttery smooth fade */}
                <div className="flex-1 w-full bg-gradient-to-b from-foreground/[0.08] dark:from-foreground/[0.15] via-foreground/[0.01] dark:via-foreground/[0.04] to-transparent" />
              </motion.div>
            </div>

            {/* Status indicator pill floating below the line */}
            <div className="flex justify-center -mt-6 pointer-events-auto">
              <motion.div
                layoutId="task-pill"
                className="bg-background/80 backdrop-blur-md border border-border px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2"
              >
                {activeTask.progress < activeTask.total ? (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                ) : (
                  <ShieldCheck className="h-3 w-3 text-emerald-500" />
                )}
                <span className="text-xs font-mono font-medium whitespace-nowrap tabular-nums min-w-[9.5rem] text-center">
                  {activeTask.message ||
                    `${activeTask.type === "scan" ? "Scanning" : "Unfollowing"} ${activeTask.progress}/${activeTask.total}`}
                </span>
                {activeTask.isWaiting && (
                  <>
                    <div className="w-px h-3 bg-border" />
                    <span className="text-[10px] text-amber-500 font-medium flex items-center gap-1">
                      <Timer className="h-3 w-3 animate-pulse" /> Rate limit
                      pause
                    </span>
                  </>
                )}
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
