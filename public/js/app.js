            // Dynamically determine API base URL (works for both local dev and production)
            const API_BASE = window.location.origin + "/api";
            const defaultExpenseCategories = [
                "Home Upkeep",
                "School Upkeep",
                "School Fees",
                "Projects",
            ];
            let customCategories = [];

            function getStoredUser() {
                try {
                    // Prefer the newer 'appCurrentUser' key; fall back to legacy 'currentUser'
                    const raw =
                        localStorage.getItem("appCurrentUser") ??
                        localStorage.getItem("currentUser");
                    return JSON.parse(raw || "null");
                } catch (err) {
                    console.warn(
                        "Stored user data was invalid; clearing entry.",
                        err,
                    );
                    try {
                        localStorage.removeItem("currentUser");
                        localStorage.removeItem("appCurrentUser");
                    } catch (e) {}
                    return null;
                }
            }

            let authToken = localStorage.getItem("authToken");
            // Use a less-generic global name to avoid collisions with other scripts
            // localStorage key remains 'currentUser' for compatibility with firebase-config.js
            let appCurrentUser = getStoredUser();
            let expenses = [];
            let blogPosts = [];
            let budgets = [];
            let budgetAlerts = [];
            let overdueAlerts = [];
            let dueSoonAlerts = [];
            let lastAlertSignature = "";
            let storageInfo = { storageMode: "sqlite", libsqlUrl: null };
            const filters = {
                session_term: "",
                category: "",
                status: "",
                search: "",
                startDate: "",
                endDate: "",
                minAmount: "",
                maxAmount: "",
                sortBy: "date_desc",
            };

            const ensureFirebaseReady = async (timeoutMs = 5000) => {
                if (window.firebaseInitPromise) {
                    try {
                        // Fail fast if initialization doesn't complete in reasonable time
                        await Promise.race([
                            window.firebaseInitPromise,
                            new Promise((_, rej) =>
                                setTimeout(
                                    () =>
                                        rej(new Error("Firebase init timeout")),
                                    timeoutMs,
                                ),
                            ),
                        ]);
                    } catch (err) {
                        console.error(
                            "Firebase init failed or timed out:",
                            err,
                        );
                        throw err;
                    }
                }

                if (
                    typeof window.firebaseLogin !== "function" ||
                    typeof window.firebaseRegister !== "function"
                ) {
                    throw new Error(
                        "Firebase functions not available. Please refresh the page.",
                    );
                }
            };

            const serializeUser = (user) => {
                if (!user) return null;
                const source = user.user ? user.user : user;
                if (!source) return null;
                return {
                    uid: source.uid || null,
                    email: source.email || null,
                };
            };

            const applyAuthenticatedState = async (userDetail) => {
                if (document.readyState === "loading") {
                    await new Promise((resolve) =>
                        document.addEventListener("DOMContentLoaded", resolve, {
                            once: true,
                        }),
                    );
                }

                await ensureFirebaseReady();
                const snapshot = serializeUser(userDetail) || getStoredUser();
                if (!snapshot) return;

                appCurrentUser = snapshot;

                const authScreen = document.querySelector("#authScreen");
                const app = document.querySelector("#app");
                const usernameDisplay =
                    document.querySelector("#usernameDisplay");

                if (authScreen) authScreen.classList.add("hidden");
                if (app) app.classList.remove("hidden");
                if (usernameDisplay) {
                    usernameDisplay.textContent =
                        snapshot.email || snapshot.uid || "";
                }

                try {
                    const latestToken = await getIdToken();
                    if (latestToken) {
                        authToken = latestToken;
                        localStorage.setItem("authToken", latestToken);
                    }
                } catch (err) {
                    console.error("Unable to refresh auth token:", err);
                }

                try {
                    localStorage.setItem(
                        "currentUser",
                        JSON.stringify(snapshot),
                    );
                } catch (err) {
                    console.warn("Unable to persist user snapshot:", err);
                }

                try {
                    await loadData();
                } catch (error) {
                    console.error("Failed to hydrate data after auth:", error);
                }
            };

            window.addEventListener("auth:ready", (event) => {
                applyAuthenticatedState(event.detail?.user);
            });

            window.addEventListener("auth:cleared", () => {
                appCurrentUser = null;
                authToken = null;
                expenses = [];
                blogPosts = [];
                budgets = [];
                budgetAlerts = [];
                lastAlertSignature = "";
                try {
                    localStorage.removeItem("authToken");
                    localStorage.removeItem("currentUser");
                } catch (err) {
                    console.warn("Unable to clear stored auth state:", err);
                }

                const authScreen = document.querySelector("#authScreen");
                const app = document.querySelector("#app");
                if (authScreen) authScreen.classList.remove("hidden");
                if (app) app.classList.add("hidden");

                renderExpenses();
                renderBlogPosts();
                renderBudgetsTable();
            });

            // UI Helpers
            const $ = (q) => document.querySelector(q);
            const notify = (msg, err = false) => {
                const box = $("#notification");
                box.className = `fixed bottom-4 right-4 ${err ? "bg-red-500" : "bg-green-500"} text-white px-6 py-3 rounded-lg shadow-lg`;
                $("#notificationText").textContent = msg;
                box.classList.remove("hidden");
                setTimeout(() => box.classList.add("hidden"), 3000);
            };

            const fmtMoney = (n) =>
                new Intl.NumberFormat("en-NG", {
                    style: "currency",
                    currency: "NGN",
                }).format(n || 0);

            /** Escape user-supplied strings before inserting into HTML to prevent XSS. */
            const escapeHtml = (str) => {
                if (str == null) return "";
                return String(str)
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#39;");
            };

            const updateStorageBadge = (info) => {
                storageInfo = { ...storageInfo, ...info };
                const badge = $("#storageBadge");
                if (!badge) return;
                const label =
                    storageInfo.storageMode === "libsql"
                        ? "Synced via Turso"
                        : "Local SQLite";
                badge.textContent = storageInfo.libsqlUrl ? `${label}` : label;
                badge.classList.remove("hidden");
            };

            const buildExpenseQuery = () => {
                const params = new URLSearchParams();
                if (filters.search) params.append("q", filters.search);
                if (filters.session_term)
                    params.append("session_term", filters.session_term);
                if (filters.category)
                    params.append("category", filters.category);
                if (filters.status) params.append("status", filters.status);
                if (filters.startDate)
                    params.append("startDate", filters.startDate);
                if (filters.endDate) params.append("endDate", filters.endDate);
                if (filters.minAmount) params.append("minAmount", filters.minAmount);
                if (filters.maxAmount) params.append("maxAmount", filters.maxAmount);
                if (filters.sortBy && filters.sortBy !== "date_desc")
                    params.append("sortBy", filters.sortBy);
                const qs = params.toString();
                return qs ? `?${qs}` : "";
            };

            const updateActiveFiltersLabel = () => {
                const label = $("#activeFilters");
                if (!label) return;
                const active = Object.entries(filters)
                    .filter(([_, value]) => Boolean(value))
                    .map(([key, value]) => `${key}: ${value}`);
                label.textContent = active.length
                    ? `Active filters → ${active.join(", ")}`
                    : "";
            };

            const syncFilterInputs = () => {
                const search = $("#filterSearch");
                const term = $("#filterTerm");
                const category = $("#filterCategory");
                const status = $("#filterStatus");
                const startDate = $("#filterStartDate");
                const endDate = $("#filterEndDate");
                const minAmount = $("#filterMinAmount");
                const maxAmount = $("#filterMaxAmount");
                const sortBy = $("#filterSortBy");
                if (search) search.value = filters.search;
                if (term) term.value = filters.session_term;
                if (category) category.value = filters.category;
                if (status) status.value = filters.status;
                if (startDate) startDate.value = filters.startDate;
                if (endDate) endDate.value = filters.endDate;
                if (minAmount) minAmount.value = filters.minAmount;
                if (maxAmount) maxAmount.value = filters.maxAmount;
                if (sortBy) sortBy.value = filters.sortBy || "date_desc";
            };

            const toNumber = (value) => {
                const num = Number(value);
                return Number.isFinite(num) ? num : 0;
            };

            const normalizeImportDate = (value) => {
                if (!value)
                    return new Date()
                        .toISOString()
                        .slice(0, 16)
                        .replace("T", " ");
                const str = value.toString().trim();
                if (!str)
                    return new Date()
                        .toISOString()
                        .slice(0, 16)
                        .replace("T", " ");
                if (str.includes("T"))
                    return str.replace("T", " ").slice(0, 16);
                if (str.length === 10) return `${str} 00:00`;
                return str.slice(0, 16);
            };

            // API Helper
            let _tokenPromise = null;
            async function getSharedIdToken() {
                if (!_tokenPromise) {
                    _tokenPromise = (async () => {
                        await ensureFirebaseReady();
                        return typeof getIdToken === "function" ? await getIdToken() : null;
                    })().finally(() => {
                        // allow refresh on next burst after a short window
                        setTimeout(() => { _tokenPromise = null; }, 2500);
                    });
                }
                return _tokenPromise;
            }

            const apiCall = async (endpoint, options = {}, timeoutMs = 15000) => {
                const token = await getSharedIdToken();
                const config = {
                    headers: {
                        "Content-Type": "application/json",
                    },
                    ...options,
                };

                if (options.body) {
                    config.body = JSON.stringify(options.body);
                }

                // Attach abort controller for timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
                config.signal = controller.signal;

                try {
                    if (!window.appLocalOnly && token) {
                        config.headers["Authorization"] = `Bearer ${token}`;
                    }
                    const response = await fetch(
                        `${API_BASE}${endpoint}`,
                        config,
                    );
                    clearTimeout(timeoutId);
                    const data = await response.json();

                    if (!response.ok) {
                        throw new Error(data.error || "Request failed");
                    }

                    return data;
                } catch (error) {
                    clearTimeout(timeoutId);
                    if (error.name === "AbortError") {
                        throw new Error("Request timed out. Please try again.");
                    }
                    console.error("API Error:", error);
                    throw error;
                }
            };

            async function hydrateStorageInfo() {
                try {
                    const response = await fetch(`${API_BASE}/status`);
                    if (!response.ok) return;
                    const info = await response.json();
                    updateStorageBadge(info);
                } catch (error) {
                    console.warn("Status check failed:", error);
                }
            }

            // Authentication
            async function login(email, password) {
                try {
                    await ensureFirebaseReady();
                    const result = await firebaseLogin(email, password);
                    const idToken = await getIdToken();
                    const snapshot = serializeUser(result.user);
                    appCurrentUser = snapshot;
                    authToken = idToken;
                    if (snapshot) {
                        localStorage.setItem(
                            "currentUser",
                            JSON.stringify(snapshot),
                        );
                    }
                    if (idToken) {
                        localStorage.setItem("authToken", idToken);
                    }
                    return { token: idToken, user: snapshot };
                } catch (error) {
                    throw new Error(error.message);
                }
            }

            async function register(email, password) {
                try {
                    await ensureFirebaseReady();
                    const result = await firebaseRegister(email, password);
                    const idToken = await getIdToken();
                    const snapshot = serializeUser(result.user);
                    appCurrentUser = snapshot;
                    authToken = idToken;
                    if (snapshot) {
                        localStorage.setItem(
                            "currentUser",
                            JSON.stringify(snapshot),
                        );
                    }
                    if (idToken) {
                        localStorage.setItem("authToken", idToken);
                    }
                    return { token: idToken, user: snapshot };
                } catch (error) {
                    throw new Error(error.message);
                }
            }

            function logout() {
                if (typeof firebaseLogout === "function") {
                    firebaseLogout();
                }
                appCurrentUser = null;
                authToken = null;
                localStorage.removeItem("currentUser");
                localStorage.removeItem("authToken");
                $("#authScreen").classList.remove("hidden");
                $("#app").classList.add("hidden");
            }

            // Expose loadData and filters to filter-enhancements.js
            // IMPORTANT: capture the hoisted function reference BEFORE assigning to
            // window.loadData, otherwise the arrow calls window.loadData (itself) → infinite recursion.
            const _loadDataFn = loadData;
            window.loadData = () => _loadDataFn();
            window.appFilters = filters;

            // Data Management
            async function loadData() {
                try {
                    document.body.style.cursor = "wait";
                    // Best-effort refresh of native JWT before loading data
                    await tryRefreshToken();

                    const pageSize =
                        window.expensePageSize &&
                        Number.isFinite(window.expensePageSize)
                            ? window.expensePageSize
                            : 10;
                    const qs = new URLSearchParams();
                    const filterQs = buildExpenseQuery().replace(/^\?/, "");
                    if (filterQs) {
                        filterQs
                            .split("&")
                            .filter(Boolean)
                            .forEach((kv) => {
                                const [k, v] = kv.split("=");
                                if (k)
                                    qs.append(k, decodeURIComponent(v || ""));
                            });
                    }
                    const currentPage =
                        window.expensePage && window.expensePage > 0
                            ? window.expensePage
                            : 1;
                    qs.set("pageSize", String(pageSize));
                    qs.set("page", String(currentPage));

                    // Build count query without page param
                    const countQs = new URLSearchParams(qs);
                    countQs.delete("page");

                    // Fetch all data in parallel
                    // Build dashboard URL with optional date range
                    const dashQs = new URLSearchParams();
                    const dashStart = ($("#dashStartDate") || {}).value || "";
                    const dashEnd = ($("#dashEndDate") || {}).value || "";
                    if (dashStart) dashQs.set("startDate", dashStart);
                    if (dashEnd) dashQs.set("endDate", dashEnd);
                    const dashUrl = `/dashboard${dashQs.toString() ? "?" + dashQs.toString() : ""}`;

                    const [customCatsResp, expResp, dashboard] =
                        await Promise.all([
                            apiCall("/categories").catch(() => []),
                            apiCall(`/expenses?${qs.toString()}`).catch(() => []),
                            apiCall(dashUrl).catch(() => ({})),
                        ]);

                    customCategories = Array.isArray(customCatsResp) ? customCatsResp : [];

                    expenses = Array.isArray(expResp)
                        ? expResp
                        : expResp.items || [];
                    window.expenseHasMore = Array.isArray(expResp)
                        ? false
                        : Boolean(expResp.hasMore);
                    window.expenseNextCursor = Array.isArray(expResp)
                        ? null
                        : expResp.nextCursor || null;

                    let totalFromList = Array.isArray(expResp)
                        ? null
                        : (typeof expResp.total === "number" ? expResp.total : null);

                    if (totalFromList == null) {
                        const countResp = await apiCall(`/expenses/count?${countQs.toString()}`).catch(() => null);
                        totalFromList = countResp && typeof countResp.total === "number" ? countResp.total : null;
                    }

                    window.expenseTotal = totalFromList;
                    window.expenseTotalPages =
                        window.expenseTotal != null
                            ? Math.max(Math.ceil(window.expenseTotal / pageSize), 1)
                            : null;

                    // Blog posts are loaded on blog.html only
                    blogPosts = Array.isArray(blogPosts) ? blogPosts : [];
                    budgets = dashboard.budgets || [];
                    budgetAlerts = dashboard.alerts || [];
                    overdueAlerts = dashboard.overdue || [];
                    dueSoonAlerts = dashboard.dueSoon || [];
                    renderAlertsBell();
                    updateStorageBadge({
                        storageMode: dashboard.storageMode,
                        libsqlUrl: storageInfo.libsqlUrl,
                    });

                    renderExpenses();
                    renderDashboard(dashboard);
                    renderBudgetsTable();
                    fillBudgetCategoryOptions();
                    fillExpenseCategoryOptions();
                    fillFilterCategoryOptions();
                    renderCategoriesList();
                    announceBudgetAlerts();
                    updateActiveFiltersLabel();
                    syncFilterInputs();
                    updateExpensePaginationUI();
                } catch (error) {
                    console.error("Error loading data:", error);
                    notify(
                        "Failed to load data. Please refresh the page.",
                        true,
                    );
                } finally {
                    document.body.style.cursor = "default";
                }
            }

            function renderBudgetsTable() {
                const tbody = document.querySelector("#budgetTableBody");
                if (!tbody) return;
                if (!budgets.length) {
                    tbody.innerHTML =
                        '<tr><td colspan="3" class="p-4 text-center text-gray-500">No budgets defined yet.</td></tr>';
                    return;
                }

                tbody.innerHTML = budgets
                    .map(
                        (item) => `
                <tr class="border-b last:border-0">
                    <td class="p-3 font-medium">${escapeHtml(item.category)}</td>
                    <td class="p-3">${fmtMoney(item.threshold)}</td>
                    <td class="p-3">
                        <button data-category="${escapeHtml(item.category)}" class="text-red-600 hover:text-red-800 delete-budget">Remove</button>
                    </td>
                </tr>
            `,
                    )
                    .join("");
            }

            let recurringTemplates = [];

            async function loadRecurring() {
                try {
                    recurringTemplates = await apiCall("/recurring");
                } catch (error) {
                    recurringTemplates = [];
                    notify("Unable to load recurring expenses", true);
                }
                renderRecurringTable();
            }

            function fillRecurringCategoryOptions() {
                const select = document.querySelector("#recurringCategory");
                if (!select) return;
                const categories = new Set([
                    ...defaultExpenseCategories,
                    ...customCategories,
                    ...expenses.map((e) => e.category),
                ]);
                select.innerHTML = Array.from(categories)
                    .sort()
                    .map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`)
                    .join("");
            }

            const FREQUENCY_LABELS = {
                weekly: "Weekly",
                monthly: "Monthly",
                quarterly: "Quarterly",
                yearly: "Yearly",
            };

            function renderRecurringTable() {
                const tbody = document.querySelector("#recurringTableBody");
                if (!tbody) return;
                if (!recurringTemplates.length) {
                    tbody.innerHTML =
                        '<tr><td colspan="7" class="p-4 text-center text-gray-500">No recurring expenses yet.</td></tr>';
                    return;
                }
                tbody.innerHTML = recurringTemplates
                    .map((tpl) => {
                        const total = (Number(tpl.amount_paid) || 0) + (Number(tpl.balance_due) || 0);
                        const isActive = Number(tpl.active) === 1;
                        return `
                <tr class="border-b last:border-0">
                    <td class="p-3 font-medium">${escapeHtml(tpl.recipient)}</td>
                    <td class="p-3">${escapeHtml(tpl.category)}</td>
                    <td class="p-3">${fmtMoney(total)}</td>
                    <td class="p-3">${FREQUENCY_LABELS[tpl.frequency] || tpl.frequency}</td>
                    <td class="p-3">${escapeHtml(tpl.next_run_date)}</td>
                    <td class="p-3">${isActive ? '<span class="text-green-600 font-medium">Active</span>' : '<span class="text-gray-400 font-medium">Paused</span>'}</td>
                    <td class="p-3 flex gap-3">
                        <button data-id="${tpl.id}" data-active="${isActive ? 1 : 0}" class="text-amber-600 hover:text-amber-800 toggle-recurring">${isActive ? "Pause" : "Resume"}</button>
                        <button data-id="${tpl.id}" class="text-red-600 hover:text-red-800 delete-recurring">Remove</button>
                    </td>
                </tr>`;
                    })
                    .join("");
            }

            function syncBudgetThresholdInput() {
                const select = document.querySelector("#budgetCategory");
                const input = document.querySelector("#budgetThreshold");
                if (!select || !input) return;
                const match = budgets.find((b) => b.category === select.value);
                input.value = match ? match.threshold : "";
            }

            function fillBudgetCategoryOptions() {
                const select = document.querySelector("#budgetCategory");
                if (!select) return;
                const categories = new Set([
                    ...defaultExpenseCategories,
                    ...customCategories,
                    ...expenses.map((e) => e.category),
                    ...budgets.map((b) => b.category),
                ]);
                const current = select.value;
                select.innerHTML = Array.from(categories)
                    .sort()
                    .map((cat) => `<option value="${cat}">${cat}</option>`)
                    .join("");
                if (current && categories.has(current)) {
                    select.value = current;
                }
                syncBudgetThresholdInput();
            }

            function getAllCategories() {
                return Array.from(
                    new Set([
                        ...defaultExpenseCategories,
                        ...customCategories,
                        ...expenses.map((e) => e.category),
                    ]),
                ).sort();
            }

            function fillExpenseCategoryOptions() {
                const select = document.querySelector("#expenseCategory");
                if (!select) return;
                const categories = getAllCategories();
                const current = select.value;
                select.innerHTML = categories
                    .map((cat) => `<option value="${cat}">${cat}</option>`)
                    .join("");
                if (current && categories.includes(current)) {
                    select.value = current;
                }
            }

            function fillFilterCategoryOptions() {
                const select = document.querySelector("#filterCategory");
                if (!select) return;
                const categories = getAllCategories();
                const current = select.value;
                select.innerHTML =
                    '<option value="">All</option>' +
                    categories
                        .map((cat) => `<option value="${cat}">${cat}</option>`)
                        .join("");
                if (current) {
                    select.value = current;
                }
            }

            let purchases = [];
            window.editingPurchaseId = null;

            async function loadPurchases() {
                try {
                    purchases = await apiCall("/purchases");
                } catch (error) {
                    purchases = [];
                    notify("Unable to load purchases", true);
                }
                renderPurchasesTable();
            }

            function fillPurchaseCategoryOptions() {
                const list = document.querySelector("#purchaseCategoryList");
                if (!list) return;
                const categories = getAllCategories();
                list.innerHTML = categories
                    .map((cat) => `<option value="${escapeHtml(cat)}"></option>`)
                    .join("");
            }

            const PRIORITY_BADGE = {
                Low: '<span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">Low</span>',
                Medium: '<span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Medium</span>',
                High: '<span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">High</span>',
            };
            const PURCHASE_STATUS_BADGE = {
                Planned: '<span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">Planned</span>',
                Purchased: '<span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Purchased</span>',
                Cancelled: '<span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Cancelled</span>',
            };

            function renderPurchasesTable() {
                const tbody = document.querySelector("#purchasesTableBody");
                if (!tbody) return;
                if (!purchases.length) {
                    tbody.innerHTML =
                        '<tr><td colspan="7" class="p-4 text-center text-gray-500">No planned purchases yet.</td></tr>';
                    return;
                }
                tbody.innerHTML = purchases
                    .map((p) => {
                        const isPlanned = p.status === "Planned";
                        return `
                <tr class="border-b border-gray-100 hover:bg-gray-50">
                    <td class="p-3 font-medium">${escapeHtml(p.item)}</td>
                    <td class="p-3">${escapeHtml(p.category || "-")}</td>
                    <td class="p-3">${fmtMoney(p.estimated_cost)}</td>
                    <td class="p-3">${PRIORITY_BADGE[p.priority] || escapeHtml(p.priority)}</td>
                    <td class="p-3">${escapeHtml(p.target_date) || "-"}</td>
                    <td class="p-3">${PURCHASE_STATUS_BADGE[p.status] || escapeHtml(p.status)}</td>
                    <td class="p-3 flex gap-2">
                        ${
                            isPlanned
                                ? `<button class="text-indigo-600 hover:text-indigo-800 edit-purchase" data-id="${p.id}" title="Edit"><i class="fas fa-edit"></i></button>
                           <button class="text-green-600 hover:text-green-800 convert-purchase" data-id="${p.id}" title="Mark purchased"><i class="fas fa-check-circle"></i></button>`
                                : ""
                        }
                        ${
                            p.receipt_path
                                ? `<button class="text-gray-500 hover:text-gray-700 view-purchase-receipt" data-id="${p.id}" title="View receipt"><i class="fas fa-paperclip"></i></button>`
                                : ""
                        }
                        <button class="text-red-600 hover:text-red-800 delete-purchase" data-id="${p.id}" title="Remove"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>`;
                    })
                    .join("");
            }

            function fillPurchaseReportCategoryOptions() {
                const select = document.querySelector("#purchaseReportCategory");
                if (!select) return;
                const categories = getAllCategories();
                const current = select.value;
                select.innerHTML =
                    '<option value="">All categories</option>' +
                    categories
                        .map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`)
                        .join("");
                if (current) select.value = current;
            }

            function fillReportCategoryOptions() {
                const select = document.querySelector("#reportCategory");
                if (!select) return;
                const categories = getAllCategories();
                const current = select.value;
                select.innerHTML =
                    '<option value="">All categories</option>' +
                    categories
                        .map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`)
                        .join("");
                if (current) select.value = current;
            }

            let lastReportData = null;
            let lastPurchaseReportData = null;

            async function generateReport() {
                const qs = new URLSearchParams();
                const start = $("#reportStartDate").value;
                const end = $("#reportEndDate").value;
                const category = $("#reportCategory").value;
                const status = $("#reportStatus").value;
                if (start) qs.set("startDate", start);
                if (end) qs.set("endDate", end);
                if (category) qs.set("category", category);
                if (status) qs.set("status", status);

                try {
                    const data = await apiCall(`/reports?${qs.toString()}`);
                    lastReportData = data;
                    renderReport(data);
                } catch (error) {
                    notify("Unable to generate report", true);
                }
            }

            async function generatePurchaseReport() {
                const qs = new URLSearchParams();
                const start = $("#purchaseReportStartDate") && $("#purchaseReportStartDate").value;
                const end = $("#purchaseReportEndDate") && $("#purchaseReportEndDate").value;
                const category = $("#purchaseReportCategory") && $("#purchaseReportCategory").value;
                const status = $("#purchaseReportStatus") && $("#purchaseReportStatus").value;
                if (start) qs.set("startDate", start);
                if (end) qs.set("endDate", end);
                if (category) qs.set("category", category);
                if (status) qs.set("status", status);

                try {
                    const data = await apiCall(`/purchases/reports?${qs.toString()}`);
                    lastPurchaseReportData = data;
                    renderPurchaseReport(data);
                } catch (error) {
                    console.error("Purchase report failed:", error);
                    notify(error.message || "Unable to generate purchase report", true);
                }
            }

            function renderReport(data) {
                const stats = data.statistics || {};
                $("#reportSummaryCards").innerHTML = `
            <div class="summary-card summary-paid">
                <div class="meta"><p class="label">Total Paid</p><p class="value">${fmtMoney(stats.total_paid)}</p></div>
                <i class="fas fa-money-bill-wave"></i>
            </div>
            <div class="summary-card summary-balance">
                <div class="meta"><p class="label">Total Balance Due</p><p class="value">${fmtMoney(stats.total_balance)}</p></div>
                <i class="fas fa-calendar-minus"></i>
            </div>
            <div class="summary-card summary-total">
                <div class="meta"><p class="label">Total Expenses</p><p class="value">${stats.total_expenses || 0}</p></div>
                <i class="fas fa-file-invoice-dollar"></i>
            </div>`;

                const rowHtml = (label, r) => `
            <tr>
                <td class="p-2 font-medium">${escapeHtml(String(label))}</td>
                <td class="p-2">${r.count}</td>
                <td class="p-2">${fmtMoney(r.total_paid)}</td>
                <td class="p-2">${fmtMoney(r.total_balance)}</td>
                <td class="p-2 font-medium">${fmtMoney((Number(r.total_paid) || 0) + (Number(r.total_balance) || 0))}</td>
            </tr>`;

                $("#reportCategoryTableBody").innerHTML = (data.byCategory || [])
                    .map((r) => rowHtml(r.category, r))
                    .join("") || '<tr><td colspan="5" class="p-3 text-center text-gray-500">No data for this filter.</td></tr>';

                $("#reportStatusTableBody").innerHTML = (data.byStatus || [])
                    .map((r) => rowHtml(r.status, r))
                    .join("") || '<tr><td colspan="5" class="p-3 text-center text-gray-500">No data for this filter.</td></tr>';

                const txns = data.transactions || [];
                $("#reportTransactionsTableBody").innerHTML = txns.length
                    ? txns
                          .map((t) => {
                              const dt = t.date_time ? new Date(t.date_time).toLocaleDateString() : "-";
                              const statusBadge =
                                  Number(t.balance_due) > 0
                                      ? '<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">Partial</span>'
                                      : '<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Paid</span>';
                              return `
            <tr class="border-b border-gray-100">
                <td class="p-2">${escapeHtml(dt)}</td>
                <td class="p-2">${escapeHtml(t.category || "-")}</td>
                <td class="p-2">${escapeHtml(t.recipient || "-")}</td>
                <td class="p-2">${fmtMoney(t.amount_paid)}</td>
                <td class="p-2">${fmtMoney(t.balance_due)}</td>
                <td class="p-2">${statusBadge}</td>
            </tr>`;
                          })
                          .join("")
                    : '<tr><td colspan="6" class="p-3 text-center text-gray-500">No transactions for this filter.</td></tr>';

                $("#reportResults").classList.remove("hidden");
                $("#reportEmptyState").classList.add("hidden");
            }

            function renderPurchaseReport(data) {
                const stats = data.statistics || {};
                const summaryEl = $("#purchaseReportSummaryCards");
                if (!summaryEl) return;
                summaryEl.innerHTML = `
            <div class="summary-card summary-paid">
                <div class="meta"><p class="label">Total Est. Cost</p><p class="value">${fmtMoney(stats.total_estimated)}</p></div>
                <i class="fas fa-shopping-cart"></i>
            </div>
            <div class="summary-card summary-balance">
                <div class="meta"><p class="label">Planned</p><p class="value">${stats.planned_count || 0}</p></div>
                <i class="fas fa-clock"></i>
            </div>
            <div class="summary-card summary-total">
                <div class="meta"><p class="label">Total Purchases</p><p class="value">${stats.total_purchases || 0}</p></div>
                <i class="fas fa-list"></i>
            </div>`;

                const rowHtml = (label, r) => `
            <tr>
                <td class="p-2 font-medium">${escapeHtml(String(label))}</td>
                <td class="p-2">${r.count}</td>
                <td class="p-2 font-medium">${fmtMoney(r.total_estimated)}</td>
            </tr>`;

                $("#purchaseReportCategoryTableBody").innerHTML = (data.byCategory || [])
                    .map((r) => rowHtml(r.category, r))
                    .join("") || '<tr><td colspan="3" class="p-3 text-center text-gray-500">No data for this filter.</td></tr>';

                $("#purchaseReportStatusTableBody").innerHTML = (data.byStatus || [])
                    .map((r) => rowHtml(r.status, r))
                    .join("") || '<tr><td colspan="3" class="p-3 text-center text-gray-500">No data for this filter.</td></tr>';

                const items = data.items || [];
                $("#purchaseReportItemsTableBody").innerHTML = items.length
                    ? items
                          .map((p) => {
                              const target = p.target_date
                                  ? new Date(p.target_date).toLocaleDateString()
                                  : "-";
                              return `
            <tr class="border-b border-gray-100">
                <td class="p-2">${escapeHtml(p.item || "-")}</td>
                <td class="p-2">${escapeHtml(p.category || "-")}</td>
                <td class="p-2">${fmtMoney(p.estimated_cost)}</td>
                <td class="p-2">${PRIORITY_BADGE[p.priority] || escapeHtml(p.priority || "-")}</td>
                <td class="p-2">${escapeHtml(target)}</td>
                <td class="p-2">${PURCHASE_STATUS_BADGE[p.status] || escapeHtml(p.status || "-")}</td>
                <td class="p-2">${
                    p.receipt_path
                        ? `<a href="#" class="purchase-report-receipt-link text-primary" data-id="${escapeHtml(String(p.id))}" title="View receipt"><i class="fas fa-paperclip"></i></a>`
                        : '<span class="text-gray-300">—</span>'
                }</td>
            </tr>`;
                          })
                          .join("")
                    : '<tr><td colspan="7" class="p-3 text-center text-gray-500">No purchases for this filter.</td></tr>';

                $("#purchaseReportResults").classList.remove("hidden");
                $("#purchaseReportEmptyState").classList.add("hidden");
            }

            function escapeCsvValue(val) {
                if (val === null || val === undefined) return "";
                const str = String(val);
                if (str.includes(",") || str.includes('"') || str.includes("\n")) {
                    return '"' + str.replace(/"/g, '""') + '"';
                }
                return str;
            }

            function reportToCsv(data) {
                const lines = [];
                const stats = data.statistics || {};
                lines.push("Summary");
                lines.push(`Total Paid,${stats.total_paid || 0}`);
                lines.push(`Total Balance Due,${stats.total_balance || 0}`);
                lines.push(`Total Expenses,${stats.total_expenses || 0}`);
                lines.push("");
                lines.push("By Category");
                lines.push("Category,Entries,Paid,Balance Due,Total");
                (data.byCategory || []).forEach((r) => {
                    lines.push(`${escapeCsvValue(r.category)},${r.count},${r.total_paid},${r.total_balance},${(Number(r.total_paid) || 0) + (Number(r.total_balance) || 0)}`);
                });
                lines.push("");
                lines.push("By Status");
                lines.push("Status,Entries,Paid,Balance Due,Total");
                (data.byStatus || []).forEach((r) => {
                    lines.push(`${escapeCsvValue(r.status)},${r.count},${r.total_paid},${r.total_balance},${(Number(r.total_paid) || 0) + (Number(r.total_balance) || 0)}`);
                });
                return lines.join("\n");
            }

            function purchaseReportToCsv(data) {
                const lines = [];
                const stats = data.statistics || {};
                lines.push("Summary");
                lines.push(`Total Estimated Cost,${stats.total_estimated || 0}`);
                lines.push(`Planned,${stats.planned_count || 0}`);
                lines.push(`Purchased,${stats.purchased_count || 0}`);
                lines.push(`Total Purchases,${stats.total_purchases || 0}`);
                lines.push("");
                lines.push("By Category");
                lines.push("Category,Entries,Est. Cost");
                (data.byCategory || []).forEach((r) => {
                    lines.push(`${escapeCsvValue(r.category)},${r.count},${r.total_estimated}`);
                });
                lines.push("");
                lines.push("By Status");
                lines.push("Status,Entries,Est. Cost");
                (data.byStatus || []).forEach((r) => {
                    lines.push(`${escapeCsvValue(r.status)},${r.count},${r.total_estimated}`);
                });
                lines.push("");
                lines.push("Purchases");
                lines.push("Item,Category,Est. Cost,Priority,Target Date,Status,Has Receipt");
                (data.items || []).forEach((p) => {
                    lines.push([
                        escapeCsvValue(p.item),
                        escapeCsvValue(p.category),
                        p.estimated_cost,
                        escapeCsvValue(p.priority),
                        escapeCsvValue(p.target_date || ""),
                        escapeCsvValue(p.status),
                        p.receipt_path ? "Yes" : "No",
                    ].join(","));
                });
                return lines.join("\n");
            }

            function loadScriptOnce(src, flagKey) {
                if (window[flagKey] === true) return Promise.resolve(true);
                if (window[flagKey]) return window[flagKey];
                window[flagKey] = new Promise((resolve) => {
                    const s = document.createElement("script");
                    s.src = src;
                    s.async = true;
                    s.onload = () => {
                        window[flagKey] = true;
                        resolve(true);
                    };
                    s.onerror = () => {
                        window[flagKey] = null;
                        resolve(false);
                    };
                    document.head.appendChild(s);
                });
                return window[flagKey];
            }

            async function ensureJsPDF() {
                if (window.jspdf && window.jspdf.jsPDF) return true;
                return loadScriptOnce(
                    "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
                    "_jsPdfLoading",
                );
            }

            async function ensureHtml2Canvas() {
                if (typeof window.html2canvas === "function") return true;
                return loadScriptOnce(
                    "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
                    "_html2canvasLoading",
                );
            }

            // WYSIWYG PDF: capture the on-screen report DOM so the PDF matches
            // what the user sees (summary cards, tables, badges).
            async function exportWysiwygPdf(printAreaEl, filename) {
                if (!printAreaEl) {
                    notify("Nothing to export", true);
                    return;
                }
                const pdfReady = await ensureJsPDF();
                const canvasReady = await ensureHtml2Canvas();
                if (!pdfReady || !canvasReady || !window.jspdf || typeof window.html2canvas !== "function") {
                    notify("Unable to load PDF libraries", true);
                    return;
                }

                try {
                    notify("Preparing PDF…");
                    const canvas = await window.html2canvas(printAreaEl, {
                        scale: 2,
                        useCORS: true,
                        backgroundColor: "#ffffff",
                        logging: false,
                    });
                    const imgData = canvas.toDataURL("image/png");
                    const { jsPDF } = window.jspdf;
                    const doc = new jsPDF("p", "mm", "a4");
                    const pageWidth = doc.internal.pageSize.getWidth();
                    const pageHeight = doc.internal.pageSize.getHeight();
                    const margin = 8;
                    const usableWidth = pageWidth - margin * 2;
                    const imgHeight = (canvas.height * usableWidth) / canvas.width;
                    let heightLeft = imgHeight;
                    let position = margin;

                    doc.addImage(imgData, "PNG", margin, position, usableWidth, imgHeight);
                    heightLeft -= pageHeight - margin * 2;

                    while (heightLeft > 0) {
                        position = margin - (imgHeight - heightLeft);
                        doc.addPage();
                        doc.addImage(imgData, "PNG", margin, position, usableWidth, imgHeight);
                        heightLeft -= pageHeight - margin * 2;
                    }

                    doc.save(filename);
                    notify("PDF downloaded");
                } catch (error) {
                    console.error("PDF export failed:", error);
                    notify("Unable to export PDF", true);
                }
            }

            async function exportReportPdf() {
                await exportWysiwygPdf(
                    $("#reportPrintArea"),
                    `expense-report-${new Date().toISOString().slice(0, 10)}.pdf`,
                );
            }

            async function exportPurchaseReportPdf() {
                await exportWysiwygPdf(
                    $("#purchaseReportPrintArea"),
                    `purchase-report-${new Date().toISOString().slice(0, 10)}.pdf`,
                );
            }

            function renderCategoriesList() {
                const container = document.querySelector("#categoriesList");
                if (!container) return;
                const allCats = getAllCategories();
                if (!allCats.length) {
                    container.innerHTML =
                        '<p class="text-gray-500 text-sm">No categories yet.</p>';
                    return;
                }
                container.innerHTML = allCats
                    .map((cat) => {
                        const isDefault =
                            defaultExpenseCategories.includes(cat);
                        const isCustom = customCategories.includes(cat);
                        return `
                <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span class="font-medium text-gray-800">${cat}</span>
                    <div class="flex items-center gap-2">
                        ${isDefault ? '<span class="text-xs text-gray-400">Default</span>' : ""}
                        ${isCustom ? `<button data-category="${cat}" class="text-red-500 hover:text-red-700 delete-category text-sm"><i class="fas fa-trash"></i></button>` : ""}
                    </div>
                </div>
            `;
                    })
                    .join("");
            }

            async function addCategory(name) {
                try {
                    const resp = await apiCall("/categories", {
                        method: "POST",
                        body: { name },
                    });
                    customCategories = resp.categories || [];
                    fillBudgetCategoryOptions();
                    fillExpenseCategoryOptions();
                    fillFilterCategoryOptions();
                    renderCategoriesList();
                    notify("Category added successfully!");
                } catch (error) {
                    notify(error?.message || "Failed to add category", true);
                }
            }

            async function deleteCategory(name) {
                if (
                    !confirm(
                        `Delete category "${name}"? This won't remove existing expenses in this category.`,
                    )
                )
                    return;
                try {
                    const resp = await apiCall(
                        `/categories/${encodeURIComponent(name)}`,
                        { method: "DELETE" },
                    );
                    customCategories = resp.categories || [];
                    fillBudgetCategoryOptions();
                    fillExpenseCategoryOptions();
                    fillFilterCategoryOptions();
                    renderCategoriesList();
                    notify("Category removed successfully!");
                } catch (error) {
                    notify(error?.message || "Failed to remove category", true);
                }
            }

            function announceBudgetAlerts() {
                const totalCount =
                    budgetAlerts.length + overdueAlerts.length + dueSoonAlerts.length;
                if (!totalCount) {
                    lastAlertSignature = "";
                    return;
                }
                const signature = JSON.stringify({
                    b: budgetAlerts.map((a) => `${a.category}:${a.total}:${a.threshold}`),
                    o: overdueAlerts.map((a) => `${a.id}:${a.due_date}`),
                    d: dueSoonAlerts.map((a) => `${a.id}:${a.due_date}`),
                });
                if (signature === lastAlertSignature) return;

                const parts = [];
                if (budgetAlerts.length)
                    parts.push(
                        `${budgetAlerts.length} categor${budgetAlerts.length === 1 ? "y" : "ies"} over budget`,
                    );
                if (overdueAlerts.length)
                    parts.push(
                        `${overdueAlerts.length} payment${overdueAlerts.length === 1 ? "" : "s"} overdue`,
                    );
                if (dueSoonAlerts.length)
                    parts.push(
                        `${dueSoonAlerts.length} due soon`,
                    );
                notify(parts.join(", "), true);
                lastAlertSignature = signature;
            }

            function renderAlertsBell() {
                const badge = $("#alertsBadge");
                const body = $("#alertsDropdownBody");
                if (!badge || !body) return;

                const total =
                    budgetAlerts.length + overdueAlerts.length + dueSoonAlerts.length;
                badge.textContent = String(total);
                badge.classList.toggle("hidden", total === 0);

                if (!total) {
                    body.innerHTML = '<p class="alerts-empty">You\'re all caught up.</p>';
                    return;
                }

                const sections = [];
                if (overdueAlerts.length) {
                    sections.push(`
            <div class="alerts-section">
                <h4>Overdue</h4>
                ${overdueAlerts
                    .map(
                        (a) => `
                <div class="alert-chip alert-chip-danger">
                    <strong>${escapeHtml(a.recipient || a.category)}</strong>
                    ${fmtMoney(a.balance_due)} was due ${escapeHtml(a.due_date)}
                </div>`,
                    )
                    .join("")}
            </div>`);
                }
                if (dueSoonAlerts.length) {
                    sections.push(`
            <div class="alerts-section">
                <h4>Due Soon</h4>
                ${dueSoonAlerts
                    .map(
                        (a) => `
                <div class="alert-chip">
                    <strong>${escapeHtml(a.recipient || a.category)}</strong>
                    ${fmtMoney(a.balance_due)} due ${escapeHtml(a.due_date)}
                </div>`,
                    )
                    .join("")}
            </div>`);
                }
                if (budgetAlerts.length) {
                    sections.push(`
            <div class="alerts-section">
                <h4>Over Budget</h4>
                ${budgetAlerts
                    .map(
                        (a) => `
                <div class="alert-chip">
                    <strong>${escapeHtml(a.category)}</strong>
                    ${fmtMoney(a.total)} / limit ${fmtMoney(a.threshold)}
                </div>`,
                    )
                    .join("")}
            </div>`);
                }
                body.innerHTML = sections.join("");
            }

            /**
             * RFC 4180-compliant CSV parser that handles:
             * - Fields quoted with double-quotes (allowing commas inside)
             * - Escaped double-quotes ("") inside quoted fields
             * - Windows and Unix line endings
             */
            const parseCsv = (text) => {
                const results = [];
                const lines = text.split(/\r?\n/);
                if (!lines.length) return [];

                // Parse a single CSV row respecting quoted fields
                const parseRow = (line) => {
                    const fields = [];
                    let i = 0;
                    while (i < line.length) {
                        if (line[i] === '"') {
                            // Quoted field
                            let field = "";
                            i++; // skip opening quote
                            while (i < line.length) {
                                if (line[i] === '"' && line[i + 1] === '"') {
                                    field += '"';
                                    i += 2;
                                } else if (line[i] === '"') {
                                    i++; // skip closing quote
                                    break;
                                } else {
                                    field += line[i++];
                                }
                            }
                            fields.push(field);
                            if (line[i] === ",") i++; // skip comma
                        } else {
                            // Unquoted field
                            const end = line.indexOf(",", i);
                            if (end === -1) {
                                fields.push(line.slice(i).trim());
                                break;
                            } else {
                                fields.push(line.slice(i, end).trim());
                                i = end + 1;
                            }
                        }
                    }
                    return fields;
                };

                const nonEmpty = lines.filter((l) => l.trim());
                if (!nonEmpty.length) return [];
                const headers = parseRow(nonEmpty[0]).map((h) => h.trim());
                for (const line of nonEmpty.slice(1)) {
                    const values = parseRow(line);
                    const row = {};
                    headers.forEach((header, idx) => {
                        row[header] = values[idx] !== undefined ? values[idx] : "";
                    });
                    results.push(row);
                }
                return results;
            };

            /** Build a dedup key from an expense entry to prevent duplicate imports */
            const expenseDedupKey = (e) =>
                `${(e.date_time || e.dateTime || "").slice(0, 16)}|${(e.recipient || "").toLowerCase().trim()}|${(e.description || "").toLowerCase().trim()}|${e.amount_paid ?? e.amountPaid ?? 0}`;

            async function processImportedData(data) {
                const result = { expenses: 0, blogPosts: 0, skipped: 0 };

                // Build a set of keys from already-loaded expenses to prevent duplicates
                const existingKeys = new Set(expenses.map(expenseDedupKey));

                if (Array.isArray(data.expenses)) {
                    for (const entry of data.expenses) {
                        try {
                            const payload = {
                                date_time: normalizeImportDate(
                                    entry.date_time || entry.dateTime,
                                ),
                                category: entry.category || "General",
                                session_term:
                                    entry.session_term ||
                                    entry.sessionTerm ||
                                    "",
                                recipient: entry.recipient || "Unknown",
                                description:
                                    entry.description || "Imported expense",
                                amount_paid: toNumber(
                                    entry.amount_paid ?? entry.amountPaid,
                                ),
                                balance_due: toNumber(
                                    entry.balance_due ?? entry.balanceDue,
                                ),
                            };
                            const key = expenseDedupKey(payload);
                            if (existingKeys.has(key)) {
                                result.skipped += 1;
                                continue;
                            }
                            await apiCall("/expenses", {
                                method: "POST",
                                body: payload,
                            });
                            existingKeys.add(key);
                            result.expenses += 1;
                        } catch (error) {
                            console.error("Import expense error:", error);
                        }
                    }
                }

                if (Array.isArray(data.blogPosts)) {
                    for (const entry of data.blogPosts) {
                        try {
                            const payload = {
                                date_time: normalizeImportDate(
                                    entry.date_time || entry.dateTime,
                                ),
                                category:
                                    entry.category || "Financial Insights",
                                title: entry.title || "Imported Post",
                                content: entry.content || "",
                            };
                            await apiCall("/blog-posts", {
                                method: "POST",
                                body: payload,
                            });
                            result.blogPosts += 1;
                        } catch (error) {
                            console.error("Import blog error:", error);
                        }
                    }
                }

                return result;
            }

            async function handleImportFile(file) {
                if (!file) return;
                try {
                    const text = await file.text();
                    let payload;
                    const name = file.name.toLowerCase();

                    if (name.endsWith(".json")) {
                        const parsed = JSON.parse(text);
                        payload = Array.isArray(parsed)
                            ? {
                                  expenses: parsed.filter(
                                      (item) => item.type === "expense",
                                  ),
                                  blogPosts: parsed.filter(
                                      (item) => item.type === "blog",
                                  ),
                              }
                            : parsed;
                    } else if (name.endsWith(".csv")) {
                        const rows = parseCsv(text);
                        const expensesRows = [];
                        const postRows = [];
                        rows.forEach((row) => {
                            const type = (row.type || "").toLowerCase();
                            if (type === "blog" || type === "post") {
                                postRows.push(row);
                            } else {
                                expensesRows.push(row);
                            }
                        });
                        payload = {
                            expenses: expensesRows,
                            blogPosts: postRows,
                        };
                    } else {
                        throw new Error(
                            "Unsupported file type. Use JSON or CSV.",
                        );
                    }

                    const summary = await processImportedData(payload);
                    const skippedMsg = summary.skipped > 0 ? ` (${summary.skipped} duplicate${summary.skipped > 1 ? "s" : ""} skipped)` : "";
                    notify(
                        `Import complete: ${summary.expenses} expenses, ${summary.blogPosts} posts${skippedMsg}.`,
                    );
                    await loadData();
                } catch (error) {
                    console.error("Import failed:", error);
                    notify(error.message || "Import failed", true);
                } finally {
                    const input = document.querySelector("#importFile");
                    if (input) input.value = "";
                }
            }

            async function receiptFetch(endpoint, options = {}) {
                const token = await getSharedIdToken();
                const headers = { ...(options.headers || {}) };
                if (!window.appLocalOnly && token) {
                    headers["Authorization"] = `Bearer ${token}`;
                }
                return fetch(`${API_BASE}${endpoint}`, { ...options, headers });
            }

            function setPurchaseReceiptAddMode(isAdd) {
                const btn = $("#uploadPurchaseReceiptBtn");
                const hint = $("#purchaseReceiptAddHint");
                // Keep "Upload now" available when editing an existing purchase.
                // On add, the chosen file attaches automatically on Save.
                if (btn) btn.classList.toggle("hidden", isAdd);
                if (hint) {
                    hint.textContent = isAdd
                        ? "Image or PDF, up to 5 MB. Chosen files attach automatically when you save."
                        : "Image or PDF, up to 5 MB. Click Upload now, or choose a file and Save.";
                    hint.classList.remove("hidden");
                }
            }

            function showPurchaseReceiptState(hasFile) {
                const noFile = $("#purchaseReceiptNoFile");
                const hasFileEl = $("#purchaseReceiptHasFile");
                if (!noFile || !hasFileEl) return;
                noFile.classList.toggle("hidden", hasFile);
                hasFileEl.classList.toggle("hidden", !hasFile);
                hasFileEl.classList.toggle("flex", hasFile);
            }

            function updatePurchaseReceiptFileName() {
                const input = $("#purchaseReceiptFileInput");
                const label = $("#purchaseReceiptFileName");
                if (!input || !label) return;
                const file = input.files && input.files[0];
                if (file) {
                    label.textContent = `Selected: ${file.name} (${Math.round(file.size / 1024)} KB)`;
                    label.classList.remove("hidden");
                } else {
                    label.textContent = "";
                    label.classList.add("hidden");
                }
            }

            async function openReceiptFor(resource, id) {
                try {
                    const res = await receiptFetch(`/${resource}/${id}/receipt`);
                    if (!res.ok) {
                        notify("Unable to load receipt", true);
                        return;
                    }
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    window.open(url, "_blank");
                } catch (error) {
                    notify("Unable to load receipt", true);
                }
            }

            // Convert a File to a JSON-safe payload. Firebase Hosting rewrites to
            // Cloud Functions are unreliable with multipart/form-data, so we send
            // receipts as base64 JSON instead.
            async function fileToReceiptPayload(file) {
                if (!file) throw new Error("No file selected");
                if (file.size > 5 * 1024 * 1024) {
                    throw new Error("File must be 5 MB or smaller");
                }
                const allowed = [
                    "image/jpeg",
                    "image/png",
                    "image/webp",
                    "image/gif",
                    "application/pdf",
                ];
                if (!allowed.includes(file.type)) {
                    throw new Error("Only JPEG, PNG, WEBP, GIF, or PDF files are allowed");
                }
                const buffer = await file.arrayBuffer();
                const bytes = new Uint8Array(buffer);
                let binary = "";
                const chunk = 0x8000;
                for (let i = 0; i < bytes.length; i += chunk) {
                    binary += String.fromCharCode.apply(
                        null,
                        bytes.subarray(i, i + chunk),
                    );
                }
                return {
                    contentBase64: btoa(binary),
                    contentType: file.type,
                    fileName: file.name || "receipt",
                };
            }

            // Upload a receipt file for an already-created purchase (or expense).
            async function uploadReceiptFile(resource, id, file) {
                const payload = await fileToReceiptPayload(file);
                return apiCall(`/${resource}/${id}/receipt`, {
                    method: "POST",
                    body: payload,
                }, 60000);
            }

            function renderExpenses() {
                const emptyExp = $("#emptyExpenseState");
                const tblCont = $("#expenseTableContainer");
                const tbody = $("#expenseTableBody");

                if (expenses.length > 0) {
                    emptyExp.classList.add("hidden");
                    tblCont.classList.remove("hidden");

                    tbody.innerHTML = expenses
                        .map(
                            (expense) => `
                <tr class="border-b border-gray-100 hover:bg-gray-50">
                    <td class="p-4 text-gray-600">${new Date(expense.date_time).toLocaleDateString()}<br>
                        <span class="text-xs text-gray-400">${new Date(expense.date_time).toLocaleTimeString()}</span>
                    </td>
                    <td class="p-4"><span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">${escapeHtml(expense.category)}</span></td>
                    <td class="p-4">${escapeHtml(expense.session_term) || "-"}</td>
                    <td class="p-4">${escapeHtml(expense.recipient)}</td>
                    <td class="p-4 max-w-xs" title="${escapeHtml(expense.description)}">${escapeHtml(expense.description.substring(0, 50))}${expense.description.length > 50 ? "..." : ""}</td>
                    <td class="p-4 font-medium text-green-600">${fmtMoney(expense.amount_paid)}</td>
                    <td class="p-4 font-medium text-orange-600">${fmtMoney(expense.balance_due)}</td>
                    <td class="p-4">${
                        expense.balance_due > 0
                            ? '<span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">Partial</span>'
                            : '<span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Paid</span>'
                    }</td>
                    <td class="p-4 flex gap-2">
                        <button class="text-indigo-600 hover:text-indigo-800 edit-expense" data-id="${escapeHtml(String(expense.id))}"><i class="fas fa-edit"></i></button>
                        <button class="text-red-600 hover:text-red-800 delete-expense" data-id="${escapeHtml(String(expense.id))}"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `,
                        )
                        .join("");
                } else {
                    emptyExp.classList.remove("hidden");
                    tblCont.classList.add("hidden");
                }
            }

            // Pagination state and helpers for expenses
            window.expensePage = 1; // current page number (1-based)
            window.expensePageSize = (() => {
                try {
                    return (
                        parseInt(localStorage.getItem("expensePageSize"), 10) ||
                        10
                    );
                } catch {
                    return 10;
                }
            })();
            window.expenseTotal = null; // total items (from count)
            window.expenseTotalPages = null; // derived from total and page size
            window.expenseCursor = null; // retained for compatibility (not used for go-to)
            window.expenseNextCursor = null; // next cursor from last fetch
            window.expenseHasMore = false; // server reported more pages
            window.expensePrevCursors = []; // retained for compatibility

            function resetExpensePagination() {
                window.expensePage = 1;
                window.expenseCursor = null;
                window.expenseNextCursor = null;
                window.expenseHasMore = false;
                window.expensePrevCursors = [];
            }
            // Expose to filter-enhancements.js
            window.resetExpensePagination = resetExpensePagination;

            function updateExpensePaginationUI() {
                const pager = document.querySelector("#expensePagination");
                if (!pager) return;
                const hasData = expenses && expenses.length > 0;
                pager.classList.toggle("hidden", !hasData);
                const prevBtn = document.querySelector("#expensePrevPage");
                const nextBtn = document.querySelector("#expenseNextPage");
                const info = document.querySelector("#expensePageInfo");
                const totalInfo = document.querySelector("#expenseTotalInfo");
                const sizeSel = document.querySelector("#expensePageSize");
                const pageNum = window.expensePage || 1;
                const totalPages = window.expenseTotalPages || 1;
                if (info) info.textContent = `Page ${pageNum} of ${totalPages}`;
                if (totalInfo) {
                    const total = window.expenseTotal;
                    totalInfo.textContent =
                        typeof total === "number" ? `(Total ${total})` : "";
                }
                if (sizeSel) {
                    sizeSel.value = String(window.expensePageSize || 10);
                }
                if (prevBtn) prevBtn.disabled = pageNum <= 1;
                if (nextBtn)
                    nextBtn.disabled =
                        window.expenseTotalPages != null
                            ? pageNum >= window.expenseTotalPages
                            : !window.expenseHasMore;
            }

            async function goNextExpensesPage() {
                // page-based navigation
                window.expensePage = (window.expensePage || 1) + 1;
                await loadData();
            }

            async function goPrevExpensesPage() {
                const page = window.expensePage || 1;
                if (page <= 1) return;
                window.expensePage = page - 1;
                await loadData();
            }

            function renderBlogPosts() {
                // Blog posts now render on dedicated blog.html page
            }

            // ── Trash / Restore ──
            async function loadTrash() {
                const modal = $("#trashModal");
                modal.classList.remove("hidden");
                $("#trashList").innerHTML = '<p class="text-center text-gray-400 py-4">Loading…</p>';
                $("#trashEmpty").classList.add("hidden");
                try {
                    const rows = await apiCall("/expenses/trash");
                    renderTrashItems(rows);
                } catch (err) {
                    $("#trashList").innerHTML = '<p class="text-center text-red-500 py-4">Failed to load trash.</p>';
                }
            }

            function renderTrashItems(rows) {
                const list = $("#trashList");
                const empty = $("#trashEmpty");
                if (!rows || rows.length === 0) {
                    list.innerHTML = "";
                    empty.classList.remove("hidden");
                    return;
                }
                empty.classList.add("hidden");
                list.innerHTML = rows.map((e) => `
                    <div class="flex items-center justify-between border rounded-lg p-3 bg-gray-50 gap-2" data-trash-id="${escapeHtml(String(e.id))}">
                        <div class="min-w-0">
                            <p class="font-medium text-gray-800 truncate">${escapeHtml(e.description || "—")}</p>
                            <p class="text-xs text-gray-500">${escapeHtml(e.category || "")} · ${escapeHtml(e.date_time || "")} · Deleted: ${escapeHtml(e.deleted_at || "")}</p>
                        </div>
                        <div class="flex gap-2 shrink-0">
                            <button class="trash-restore-btn text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700" data-id="${escapeHtml(String(e.id))}">
                                <i class="fas fa-undo mr-1"></i>Restore
                            </button>
                            <button class="trash-perm-btn text-xs bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700" data-id="${escapeHtml(String(e.id))}">
                                <i class="fas fa-times mr-1"></i>Delete
                            </button>
                        </div>
                    </div>`).join("");
            }

            // ── Try refresh native JWT token ──
            async function tryRefreshToken() {
                try {
                    if (!authToken) return;
                    // Only refresh server-issued JWTs (not Firebase tokens)
                    const parts = authToken.split(".");
                    if (parts.length !== 3) return;
                    const payload = JSON.parse(atob(parts[1]));
                    if (payload.iss && payload.iss.includes("firebase")) return;
                    if (payload.iss && payload.iss.includes("securetoken")) return;
                    // Refresh if less than 2 hours remain
                    const expiresIn = (payload.exp || 0) - Math.floor(Date.now() / 1000);
                    if (expiresIn > 7200) return;
                    const data = await apiCall("/auth/refresh", { method: "POST" }, 5000);
                    if (data && data.token) {
                        authToken = data.token;
                        try { localStorage.setItem("authToken", data.token); } catch (e) {}
                    }
                } catch (err) {
                    // Silent — refresh is best-effort
                }
            }

            function renderDashboard(dashboard) {
                const statistics = dashboard.statistics || { total_paid: 0, total_balance: 0, total_expenses: 0, total_cost: 0 };
                const categories = dashboard.categories || [];
                const budgetMap = budgets.reduce((acc, item) => {
                    acc[item.category] = item.threshold;
                    return acc;
                }, {});
                const alertSet = new Set(
                    (dashboard.alerts || []).map((alert) => alert.category),
                );

                $("#summaryCards").innerHTML = `
            <div class="summary-card summary-paid">
                <div class="meta">
                    <p class="label">Total Paid</p>
                    <p class="value">${fmtMoney(statistics.total_paid)}</p>
                </div>
                <i class="fas fa-money-bill-wave"></i>
            </div>
            <div class="summary-card summary-balance">
                <div class="meta">
                    <p class="label">Total Balance Due</p>
                    <p class="value">${fmtMoney(statistics.total_balance)}</p>
                </div>
                <i class="fas fa-calendar-minus"></i>
            </div>
            <div class="summary-card summary-total">
                <div class="meta">
                    <p class="label">Total Expenses</p>
                    <p class="value">${statistics.total_expenses}</p>
                </div>
                <i class="fas fa-file-invoice-dollar"></i>
            </div>
        `;

                // Written-out category totals (name, total, number of entries)
                const summaryGrid = $("#categorySummaryGrid");
                if (summaryGrid) {
                    if (!categories.length) {
                        summaryGrid.innerHTML =
                            '<p class="cat-summary-empty">No expenses recorded yet.</p>';
                    } else {
                        summaryGrid.innerHTML = categories
                            .map((cat) => {
                                const total =
                                    (Number(cat.total_paid) || 0) +
                                    (Number(cat.total_balance) || 0);
                                const count = Number(cat.count) || 0;
                                return `
            <div class="cat-summary-item">
                <span class="cat-summary-name">${escapeHtml(cat.category)}</span>
                <span class="cat-summary-total">${fmtMoney(total)}</span>
                <span class="cat-summary-count">${count} ${count === 1 ? "entry" : "entries"}</span>
            </div>`;
                            })
                            .join("");
                    }
                }

                const alertCats = categories.filter((cat) => alertSet.has(cat.category));
                const card = $("#categoryCard");
                const breakdown = $("#categoryBreakdown");
                if (card && breakdown) {
                    if (!alertCats.length) {
                        card.classList.add("hidden");
                        breakdown.innerHTML = "";
                    } else {
                        card.classList.remove("hidden");
                        breakdown.innerHTML = alertCats
                            .map(
                                (cat) => `
            <div class="alert-chip">
                <strong>${escapeHtml(cat.category)}</strong>
                over budget — ${fmtMoney((Number(cat.total_paid)||0)+(Number(cat.total_balance)||0))}
                / limit ${fmtMoney(budgetMap[cat.category])}
            </div>`,
                            )
                            .join("");
                    }
                }

                // Render charts (uses dashboard monthlySeries when available)
                renderCharts(categories, expenses, dashboard.monthlySeries || null);
            }

            // Chart instances
            let categoryPieChart = null;
            let monthlyBarChart = null;

            async function ensureChartJs() {
                if (typeof Chart !== "undefined") return true;
                if (window._chartJsLoading) return window._chartJsLoading;
                window._chartJsLoading = new Promise((resolve, reject) => {
                    const s = document.createElement("script");
                    s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
                    s.async = true;
                    s.onload = () => resolve(true);
                    s.onerror = () => reject(new Error("Failed to load Chart.js"));
                    document.head.appendChild(s);
                }).catch((err) => {
                    console.warn(err);
                    return false;
                });
                return window._chartJsLoading;
            }

            async function renderCharts(categories, expenseData, monthlySeries) {
                const ready = await ensureChartJs();
                if (!ready || typeof Chart === "undefined") return;
                const chartColors = [
                    "rgba(59, 130, 246, 0.8)", // blue
                    "rgba(16, 185, 129, 0.8)", // green
                    "rgba(249, 115, 22, 0.8)", // orange
                    "rgba(139, 92, 246, 0.8)", // purple
                    "rgba(236, 72, 153, 0.8)", // pink
                    "rgba(20, 184, 166, 0.8)", // teal
                    "rgba(245, 158, 11, 0.8)", // amber
                    "rgba(239, 68, 68, 0.8)", // red
                ];

                // Category Pie Chart
                const pieCtx = document.getElementById("categoryPieChart");
                if (pieCtx && categories.length > 0) {
                    if (categoryPieChart) categoryPieChart.destroy();
                    categoryPieChart = new Chart(pieCtx, {
                        type: "doughnut",
                        data: {
                            labels: categories.map((c) => c.category),
                            datasets: [
                                {
                                    data: categories.map(
                                        (c) => c.total_paid + c.total_balance,
                                    ),
                                    backgroundColor: chartColors.slice(
                                        0,
                                        categories.length,
                                    ),
                                    borderWidth: 2,
                                    borderColor: "#fff",
                                },
                            ],
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: {
                                    position: "bottom",
                                    labels: {
                                        padding: 15,
                                        usePointStyle: true,
                                    },
                                },
                                tooltip: {
                                    callbacks: {
                                        label: (ctx) =>
                                            `${ctx.label}: ${fmtMoney(ctx.raw)}`,
                                    },
                                },
                            },
                        },
                    });
                }

                // Monthly Bar Chart — prefer server aggregates
                const barCtx = document.getElementById("monthlyBarChart");
                const monthlyData = {};
                if (Array.isArray(monthlySeries) && monthlySeries.length) {
                    monthlySeries.forEach((row) => {
                        const key = row.month || row.key;
                        if (!key) return;
                        monthlyData[key] = {
                            paid: Number(row.paid || row.total_paid || 0),
                            balance: Number(row.balance || row.total_balance || 0),
                        };
                    });
                } else if (expenseData && expenseData.length > 0) {
                    expenseData.forEach((exp) => {
                        const date = new Date(exp.date_time);
                        if (Number.isNaN(date.getTime())) return;
                        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
                        if (!monthlyData[key]) monthlyData[key] = { paid: 0, balance: 0 };
                        monthlyData[key].paid += exp.amount_paid || 0;
                        monthlyData[key].balance += exp.balance_due || 0;
                    });
                }
                if (barCtx && Object.keys(monthlyData).length > 0) {
                    const sortedMonths = Object.keys(monthlyData)
                        .sort()
                        .slice(-6);
                    const monthLabels = sortedMonths.map((m) => {
                        const [y, mo] = m.split("-");
                        return new Date(y, mo - 1).toLocaleDateString("en-US", {
                            month: "short",
                            year: "2-digit",
                        });
                    });

                    if (monthlyBarChart) monthlyBarChart.destroy();
                    monthlyBarChart = new Chart(barCtx, {
                        type: "bar",
                        data: {
                            labels: monthLabels,
                            datasets: [
                                {
                                    label: "Paid",
                                    data: sortedMonths.map(
                                        (m) => monthlyData[m].paid,
                                    ),
                                    backgroundColor: "rgba(16, 185, 129, 0.8)",
                                    borderRadius: 4,
                                },
                                {
                                    label: "Balance Due",
                                    data: sortedMonths.map(
                                        (m) => monthlyData[m].balance,
                                    ),
                                    backgroundColor: "rgba(249, 115, 22, 0.8)",
                                    borderRadius: 4,
                                },
                            ],
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            scales: {
                                y: {
                                    beginAtZero: true,
                                    ticks: {
                                        callback: (val) =>
                                            "₦" +
                                            (val >= 1000
                                                ? (val / 1000).toFixed(0) + "k"
                                                : val),
                                    },
                                },
                            },
                            plugins: {
                                legend: { position: "bottom" },
                                tooltip: {
                                    callbacks: {
                                        label: (ctx) =>
                                            `${ctx.dataset.label}: ${fmtMoney(ctx.raw)}`,
                                    },
                                },
                            },
                        },
                    });
                }
            }

            // Resize charts when the window changes size (charts need manual resize with maintainAspectRatio: false)
            window.addEventListener("resize", () => {
                if (categoryPieChart) categoryPieChart.resize();
                if (monthlyBarChart) monthlyBarChart.resize();
            });

            // Expense Functions
            window.editExpense = async (id) => {
                const idStr = String(id);
                const expense = expenses.find((e) => String(e.id) === idStr);
                if (!expense) return;

                $("#expenseDateTime").value = expense.date_time
                    .replace(" ", "T")
                    .substring(0, 16);
                $("#expenseCategory").value = expense.category;
                $("#expenseSession").value = expense.session_term || "";
                $("#expenseRecipient").value = expense.recipient;
                $("#expenseDescription").value = expense.description;
                $("#expenseAmountPaid").value = expense.amount_paid;
                $("#expenseBalanceDue").value = expense.balance_due;
                $("#expenseDueDate").value = expense.due_date || "";

                $("#expenseModalTitle").textContent = "Edit Expense";
                $("#expenseModal").classList.remove("hidden");
                window.editingExpenseId = id;
            };

            window.deleteExpense = async (id) => {
                if (!confirm("Are you sure you want to delete this expense?"))
                    return;

                try {
                    const idStr = String(id);
                    await apiCall(`/expenses/${encodeURIComponent(idStr)}`, {
                        method: "DELETE",
                    });
                    expenses = expenses.filter((e) => String(e.id) !== idStr);
                    renderExpenses();
                    await loadData(); // Reload dashboard stats
                    notify("Expense deleted successfully!");
                } catch (error) {
                    notify(error?.message || "Error deleting expense", true);
                }
            };



            // Event Listeners
            document.addEventListener("DOMContentLoaded", async function () {
                hydrateStorageInfo();
                fillBudgetCategoryOptions();
                syncFilterInputs();

                if (authToken && appCurrentUser) {
                    await applyAuthenticatedState(appCurrentUser);
                }

                // Authentication: call Firebase helpers and rely on auth:ready/auth:cleared events
                $("#loginBtn").addEventListener("click", async () => {
                    const email = $("#loginUsername").value.trim();
                    const password = $("#loginPassword").value.trim();

                    if (!email || !password) {
                        $("#authError").textContent =
                            "Please enter email and password";
                        $("#authError").classList.remove("hidden");
                        return;
                    }

                    try {
                        await ensureFirebaseReady();
                        await login(email, password);
                        // UI will update via auth:ready event
                    } catch (error) {
                        $("#authError").textContent =
                            error.message || "Login failed";
                        $("#authError").classList.remove("hidden");
                    }
                });

                $("#registerBtn").addEventListener("click", async () => {
                    const email = $("#registerUsername").value.trim();
                    const password = $("#registerPassword").value.trim();

                    if (!email || !password) {
                        $("#authError").textContent =
                            "Please enter email and password";
                        $("#authError").classList.remove("hidden");
                        return;
                    }

                    try {
                        await ensureFirebaseReady();
                        await register(email, password);
                        // UI will update via auth:ready event
                    } catch (error) {
                        $("#authError").textContent =
                            error.message || "Registration failed";
                        $("#authError").classList.remove("hidden");
                    }
                });

                $("#showRegister").addEventListener("click", () => {
                    $("#loginForm").classList.add("hidden");
                    $("#registerForm").classList.remove("hidden");
                    $("#authError").classList.add("hidden");
                });

                $("#showLogin").addEventListener("click", () => {
                    $("#registerForm").classList.add("hidden");
                    $("#loginForm").classList.remove("hidden");
                    $("#authError").classList.add("hidden");
                });

                $("#logoutBtn").addEventListener("click", logout);

                // Keyboard shortcuts
                document.addEventListener("keydown", (e) => {
                    // Ctrl/Cmd + N: New expense
                    if ((e.ctrlKey || e.metaKey) && e.key === "n") {
                        e.preventDefault();
                        $("#addExpenseBtn").click();
                    }
                    // Escape: Close modals
                    if (e.key === "Escape") {
                        const expenseModal = $("#expenseModal");
                        const budgetModal = $("#budgetModal");
                        const categoriesModal = $("#categoriesModal");
                        const trashModal = $("#trashModal");
                        const settingsModal = $("#settingsModal");
                        if (expenseModal && !expenseModal.classList.contains("hidden")) {
                            expenseModal.classList.add("hidden");
                        }
                        if (budgetModal && !budgetModal.classList.contains("hidden")) {
                            budgetModal.classList.add("hidden");
                        }
                        if (categoriesModal && !categoriesModal.classList.contains("hidden")) {
                            categoriesModal.classList.add("hidden");
                        }
                        if (trashModal && !trashModal.classList.contains("hidden")) {
                            trashModal.classList.add("hidden");
                        }
                        if (settingsModal && !settingsModal.classList.contains("hidden")) {
                            settingsModal.classList.add("hidden");
                        }
                    }
                    // Ctrl/Cmd + F: Focus filter
                    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
                        e.preventDefault();
                        const filterTerm = $("#filterTerm");
                        if (filterTerm) filterTerm.focus();
                    }
                });

                // Filters
                $("#applyFiltersBtn").addEventListener("click", () => {
                    filters.search = $("#filterSearch").value.trim();
                    filters.session_term = $("#filterTerm").value;
                    filters.category = $("#filterCategory").value;
                    filters.status = $("#filterStatus").value;
                    filters.startDate = $("#filterStartDate").value;
                    filters.endDate = $("#filterEndDate").value;
                    filters.minAmount = $("#filterMinAmount").value.trim();
                    filters.maxAmount = $("#filterMaxAmount").value.trim();
                    filters.sortBy = $("#filterSortBy").value || "date_desc";
                    resetExpensePagination();
                    updateActiveFiltersLabel();
                    if (typeof renderFilterChips === "function") renderFilterChips();
                    loadData();
                });

                // Allow Enter key in search to trigger filter
                $("#filterSearch").addEventListener("keydown", (e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        $("#applyFiltersBtn").click();
                    }
                });

                $("#clearFiltersBtn").addEventListener("click", () => {
                    Object.keys(filters).forEach((key) => {
                        filters[key] = key === "sortBy" ? "date_desc" : "";
                    });
                    syncFilterInputs();
                    resetExpensePagination();
                    updateActiveFiltersLabel();
                    if (typeof renderFilterChips === "function") renderFilterChips();
                    loadData();
                });

                // Dashboard date range filter
                if ($("#applyDashDateBtn")) {
                    $("#applyDashDateBtn").addEventListener("click", () => {
                        loadData();
                    });
                }
                if ($("#clearDashDateBtn")) {
                    $("#clearDashDateBtn").addEventListener("click", () => {
                        if ($("#dashStartDate")) $("#dashStartDate").value = "";
                        if ($("#dashEndDate")) $("#dashEndDate").value = "";
                        loadData();
                    });
                }

                // Import/Export
                $("#importBtn").addEventListener("click", () => {
                    const input = document.querySelector("#importFile");
                    if (input) input.click();
                });

                $("#importFile").addEventListener("change", (e) => {
                    const file = e.target.files?.[0];
                    handleImportFile(file);
                });

                // Expense Form
                $("#expenseForm").addEventListener("submit", async (e) => {
                    e.preventDefault();

                    const amountPaid = parseFloat(
                        $("#expenseAmountPaid").value,
                    );
                    const balanceDue =
                        parseFloat($("#expenseBalanceDue").value) || 0;

                    // Validation
                    if (isNaN(amountPaid) || amountPaid < 0) {
                        notify("Amount paid must be a positive number", true);
                        return;
                    }

                    if (balanceDue < 0) {
                        notify("Balance due cannot be negative", true);
                        return;
                    }

                    const expenseData = {
                        date_time: $("#expenseDateTime").value.replace(
                            "T",
                            " ",
                        ),
                        category: $("#expenseCategory").value,
                        session_term: $("#expenseSession").value,
                        recipient: $("#expenseRecipient").value,
                        description: $("#expenseDescription").value,
                        amount_paid: amountPaid,
                        balance_due: balanceDue,
                        due_date: $("#expenseDueDate").value || null,
                    };

                    try {
                        if (window.editingExpenseId) {
                            await apiCall(
                                `/expenses/${window.editingExpenseId}`,
                                {
                                    method: "PUT",
                                    body: expenseData,
                                },
                            );
                            notify("Expense updated successfully!");
                        } else {
                            await apiCall("/expenses", {
                                method: "POST",
                                body: expenseData,
                            });
                            notify("Expense added successfully!");
                        }

                        $("#expenseModal").classList.add("hidden");
                        loadData();
                        window.editingExpenseId = null;
                    } catch (error) {
                        notify(
                            error.message ||
                                "Unable to save expense. Please try again.",
                            true,
                        );
                    }
                });



                // Modal Controls
                $("#addExpenseBtn").addEventListener("click", () => {
                    window.editingExpenseId = null;
                    $("#expenseForm").reset();
                    $("#expenseDateTime").value = new Date()
                        .toISOString()
                        .slice(0, 16);
                    $("#expenseModalTitle").textContent = "Add Expense";
                    $("#expenseModal").classList.remove("hidden");
                });

                $("#addFirstExpenseBtn").addEventListener("click", () => {
                    $("#addExpenseBtn").click();
                });

                // Hook up pagination controls
                const prevBtn = document.querySelector("#expensePrevPage");
                const nextBtn = document.querySelector("#expenseNextPage");
                if (prevBtn)
                    prevBtn.addEventListener("click", () => {
                        goPrevExpensesPage();
                    });
                if (nextBtn)
                    nextBtn.addEventListener("click", () => {
                        goNextExpensesPage();
                    });
                const gotoBtn = document.querySelector("#expenseGotoBtn");
                const gotoInput = document.querySelector("#expenseGotoPage");
                const sizeSel = document.querySelector("#expensePageSize");
                if (gotoBtn && gotoInput) {
                    gotoBtn.addEventListener("click", () => {
                        const raw = parseInt(gotoInput.value, 10);
                        const totalPages = window.expenseTotalPages || 1;
                        if (!raw || raw < 1) return;
                        const target = Math.min(Math.max(raw, 1), totalPages);
                        window.expensePage = target;
                        loadData();
                    });
                    gotoInput.addEventListener("keydown", (e) => {
                        if (e.key === "Enter") {
                            gotoBtn.click();
                        }
                    });
                }
                if (sizeSel) {
                    sizeSel.addEventListener("change", () => {
                        const v = parseInt(sizeSel.value, 10) || 10;
                        window.expensePageSize = v;
                        try {
                            localStorage.setItem("expensePageSize", String(v));
                        } catch {}
                        window.expensePage = 1;
                        loadData();
                    });
                }

                $("#addBlogPostBtn").addEventListener("click", () => {
                    window.location.href = "/blog.html";
                });

                // ── Sidebar View Navigation ──
                (function initSidebarNav() {
                    const navBtns = document.querySelectorAll(".sidebar-nav-btn[data-view]");
                    const views   = document.querySelectorAll(".app-view");
                    function switchView(viewId) {
                        views.forEach(v => v.classList.remove("active"));
                        const target = document.getElementById("view-" + viewId);
                        if (target) target.classList.add("active");
                        navBtns.forEach(b => b.classList.toggle("active", b.dataset.view === viewId));
                    }
                    navBtns.forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.view)));
                })();

                // Close modals
                $("#closeExpenseModal").addEventListener("click", () =>
                    $("#expenseModal").classList.add("hidden"),
                );

                $("#cancelExpense").addEventListener("click", () =>
                    $("#expenseModal").classList.add("hidden"),
                );


                // Budget modal controls
                $("#manageBudgetsBtn").addEventListener("click", () => {
                    renderBudgetsTable();
                    fillBudgetCategoryOptions();
                    $("#budgetModal").classList.remove("hidden");
                });

                $("#closeBudgetModal").addEventListener("click", () =>
                    $("#budgetModal").classList.add("hidden"),
                );
                $("#clearBudgetForm").addEventListener("click", () => {
                    $("#budgetForm").reset();
                    fillBudgetCategoryOptions();
                });

                $("#budgetCategory").addEventListener(
                    "change",
                    syncBudgetThresholdInput,
                );

                $("#budgetForm").addEventListener("submit", async (e) => {
                    e.preventDefault();
                    const category = $("#budgetCategory").value;
                    const threshold = toNumber($("#budgetThreshold").value);
                    try {
                        await apiCall("/budgets", {
                            method: "PUT",
                            body: { category, threshold },
                        });
                        notify("Budget saved successfully!");
                        await loadData();
                        $("#budgetThreshold").value = "";
                    } catch (error) {
                        notify("Error saving budget", true);
                    }
                });

                $("#budgetTableBody").addEventListener("click", async (e) => {
                    if (e.target.matches(".delete-budget")) {
                        const category = e.target.dataset.category;
                        if (!category) return;
                        if (!confirm(`Remove budget for ${category}?`)) return;
                        try {
                            await apiCall(
                                `/budgets/${encodeURIComponent(category)}`,
                                { method: "DELETE" },
                            );
                            notify("Budget removed");
                            await loadData();
                        } catch (error) {
                            notify("Error removing budget", true);
                        }
                    }
                });

                // Reports tab controls — Expense and Purchase are separate panels
                function setReportMode(mode) {
                    const isPurchase = mode === "purchase";
                    const expensePanel = $("#expenseReportPanel");
                    const purchasePanel = $("#purchaseReportPanel");
                    if (expensePanel) expensePanel.classList.toggle("hidden", isPurchase);
                    if (purchasePanel) purchasePanel.classList.toggle("hidden", !isPurchase);
                    const expenseBtn = $("#reportModeExpenseBtn");
                    const purchaseBtn = $("#reportModePurchaseBtn");
                    if (expenseBtn) {
                        expenseBtn.classList.toggle("active", !isPurchase);
                        expenseBtn.setAttribute("aria-selected", String(!isPurchase));
                    }
                    if (purchaseBtn) {
                        purchaseBtn.classList.toggle("active", isPurchase);
                        purchaseBtn.setAttribute("aria-selected", String(isPurchase));
                    }
                    if (isPurchase) fillPurchaseReportCategoryOptions();
                    else fillReportCategoryOptions();
                }

                const reportsNavBtn = document.querySelector('.sidebar-nav-btn[data-view="reports"]');
                if (reportsNavBtn) {
                    reportsNavBtn.addEventListener("click", () => {
                        fillReportCategoryOptions();
                        fillPurchaseReportCategoryOptions();
                    });
                }
                if ($("#reportModeExpenseBtn")) {
                    $("#reportModeExpenseBtn").addEventListener("click", () => setReportMode("expense"));
                }
                if ($("#reportModePurchaseBtn")) {
                    $("#reportModePurchaseBtn").addEventListener("click", () => setReportMode("purchase"));
                }
                if ($("#gotoPurchaseReportBtn")) {
                    $("#gotoPurchaseReportBtn").addEventListener("click", () => {
                        const sideBtn = document.querySelector('.sidebar-nav-btn[data-view="reports"]');
                        if (sideBtn) sideBtn.click();
                        setReportMode("purchase");
                    });
                }
                if ($("#generateReportBtn")) {
                    $("#generateReportBtn").addEventListener("click", generateReport);
                }
                if ($("#exportReportCsvBtn")) {
                    $("#exportReportCsvBtn").addEventListener("click", () => {
                        if (!lastReportData) {
                            notify("Generate a report first", true);
                            return;
                        }
                        const csv = reportToCsv(lastReportData);
                        const blob = new Blob([csv], { type: "text/csv" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `expense-report-${new Date().toISOString().slice(0, 10)}.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                    });
                }
                if ($("#exportReportPdfBtn")) {
                    $("#exportReportPdfBtn").addEventListener("click", () => {
                        if (!lastReportData) {
                            notify("Generate a report first", true);
                            return;
                        }
                        exportReportPdf();
                    });
                }

                // Purchases tab controls
                const purchasesNavBtn = document.querySelector('.sidebar-nav-btn[data-view="purchases"]');
                if (purchasesNavBtn) {
                    purchasesNavBtn.addEventListener("click", () => {
                        loadPurchases();
                    });
                }

                if ($("#generatePurchaseReportBtn")) {
                    $("#generatePurchaseReportBtn").addEventListener("click", generatePurchaseReport);
                }
                if ($("#purchaseReportItemsTableBody")) {
                    $("#purchaseReportItemsTableBody").addEventListener("click", (e) => {
                        const link = e.target.closest(".purchase-report-receipt-link");
                        if (!link) return;
                        e.preventDefault();
                        const id = link.dataset.id;
                        if (id) openReceiptFor("purchases", id);
                    });
                }
                if ($("#exportPurchaseReportCsvBtn")) {
                    $("#exportPurchaseReportCsvBtn").addEventListener("click", () => {
                        if (!lastPurchaseReportData) {
                            notify("Generate a purchase report first", true);
                            return;
                        }
                        const csv = purchaseReportToCsv(lastPurchaseReportData);
                        const blob = new Blob([csv], { type: "text/csv" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `purchase-report-${new Date().toISOString().slice(0, 10)}.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                    });
                }
                if ($("#exportPurchaseReportPdfBtn")) {
                    $("#exportPurchaseReportPdfBtn").addEventListener("click", () => {
                        if (!lastPurchaseReportData) {
                            notify("Generate a purchase report first", true);
                            return;
                        }
                        exportPurchaseReportPdf();
                    });
                }

                function openPurchaseModal(title) {
                    fillPurchaseCategoryOptions();
                    $("#purchaseModalTitle").textContent = title;
                    $("#purchaseModal").classList.remove("hidden");
                }

                if ($("#addPurchaseBtn")) {
                    $("#addPurchaseBtn").addEventListener("click", () => {
                        window.editingPurchaseId = null;
                        $("#purchaseForm").reset();
                        // Show the receipt/quote picker on Add too; the chosen
                        // file is staged and uploaded once the purchase exists.
                        $("#purchaseReceiptSection").classList.remove("hidden");
                        showPurchaseReceiptState(false);
                        if ($("#purchaseReceiptFileInput")) $("#purchaseReceiptFileInput").value = "";
                        setPurchaseReceiptAddMode(true);
                        updatePurchaseReceiptFileName();
                        openPurchaseModal("Add Purchase");
                    });
                }
                $("#closePurchaseModal").addEventListener("click", () =>
                    $("#purchaseModal").classList.add("hidden"),
                );
                $("#cancelPurchase").addEventListener("click", () =>
                    $("#purchaseModal").classList.add("hidden"),
                );

                window.editPurchase = (id) => {
                    const p = purchases.find((x) => String(x.id) === String(id));
                    if (!p) return;
                    window.editingPurchaseId = id;
                    fillPurchaseCategoryOptions();
                    $("#purchaseItem").value = p.item;
                    $("#purchaseCategory").value = p.category || "";
                    $("#purchaseEstimatedCost").value = p.estimated_cost;
                    $("#purchasePriority").value = p.priority || "Medium";
                    $("#purchaseTargetDate").value = p.target_date || "";
                    $("#purchaseNotes").value = p.notes || "";
                    $("#purchaseReceiptFileInput").value = "";
                    $("#purchaseReceiptSection").classList.remove("hidden");
                    showPurchaseReceiptState(Boolean(p.receipt_path));
                    setPurchaseReceiptAddMode(false);
                    updatePurchaseReceiptFileName();
                    openPurchaseModal("Edit Purchase");
                };

                $("#purchaseForm").addEventListener("submit", async (e) => {
                    e.preventDefault();
                    const itemName = ($("#purchaseItem").value || "").trim();
                    if (!itemName) {
                        notify("Please type the item name", true);
                        return;
                    }
                    const cost = toNumber($("#purchaseEstimatedCost").value);
                    if (isNaN(cost) || cost < 0) {
                        notify("Estimated cost must be a positive number", true);
                        return;
                    }
                    const categoryVal = ($("#purchaseCategory").value || "").trim();
                    const body = {
                        item: itemName,
                        category: categoryVal || null,
                        estimated_cost: cost,
                        priority: $("#purchasePriority").value,
                        target_date: $("#purchaseTargetDate").value || null,
                        notes: ($("#purchaseNotes").value || "").trim(),
                    };
                    const stagedFile =
                        $("#purchaseReceiptFileInput") &&
                        $("#purchaseReceiptFileInput").files[0];
                    try {
                        let purchaseId = window.editingPurchaseId;
                        if (purchaseId) {
                            await apiCall(`/purchases/${purchaseId}`, { method: "PUT", body });
                        } else {
                            const created = await apiCall("/purchases", { method: "POST", body });
                            purchaseId = created && created.purchase && created.purchase.id;
                            if (!purchaseId) {
                                throw new Error("Purchase saved but no id was returned");
                            }
                        }

                        if (stagedFile && purchaseId) {
                            try {
                                await uploadReceiptFile("purchases", purchaseId, stagedFile);
                                notify(
                                    window.editingPurchaseId
                                        ? "Purchase and receipt updated!"
                                        : "Purchase and receipt added!",
                                );
                            } catch (uploadErr) {
                                notify(
                                    `Purchase saved, but receipt upload failed: ${uploadErr.message}`,
                                    true,
                                );
                            }
                        } else {
                            notify(
                                window.editingPurchaseId
                                    ? "Purchase updated!"
                                    : "Purchase added!",
                            );
                        }

                        if ($("#purchaseReceiptFileInput")) $("#purchaseReceiptFileInput").value = "";
                        updatePurchaseReceiptFileName();
                        $("#purchaseModal").classList.add("hidden");
                        window.editingPurchaseId = null;
                        await loadPurchases();
                    } catch (error) {
                        notify(error.message || "Unable to save purchase", true);
                    }
                });

                if ($("#purchasesTableBody")) {
                    $("#purchasesTableBody").addEventListener("click", async (e) => {
                        const btn = e.target.closest(".edit-purchase, .delete-purchase, .convert-purchase, .view-purchase-receipt");
                        if (!btn) return;
                        const id = btn.dataset.id;
                        if (!id) return;

                        if (btn.classList.contains("edit-purchase")) {
                            window.editPurchase(id);
                        } else if (btn.classList.contains("view-purchase-receipt")) {
                            openReceiptFor("purchases", id);
                        } else if (btn.classList.contains("delete-purchase")) {
                            if (!confirm("Remove this purchase?")) return;
                            try {
                                await apiCall(`/purchases/${id}`, { method: "DELETE" });
                                notify("Purchase removed");
                                await loadPurchases();
                            } catch (error) {
                                notify("Unable to remove purchase", true);
                            }
                        } else if (btn.classList.contains("convert-purchase")) {
                            const p = purchases.find((x) => String(x.id) === String(id));
                            if (!p) return;
                            const amountStr = prompt(
                                `Mark "${p.item}" as purchased.\nAmount paid now (₦):`,
                                p.estimated_cost,
                            );
                            if (amountStr === null) return;
                            const amountPaid = toNumber(amountStr);
                            if (isNaN(amountPaid) || amountPaid < 0) {
                                notify("Amount paid must be a positive number", true);
                                return;
                            }
                            const balanceStr = prompt("Balance due, if any (₦):", "0");
                            const balanceDue = toNumber(balanceStr) || 0;
                            try {
                                await apiCall(`/purchases/${id}/convert`, {
                                    method: "POST",
                                    body: { amount_paid: amountPaid, balance_due: balanceDue },
                                });
                                notify("Purchase converted to an expense!");
                                await loadPurchases();
                                await loadData();
                            } catch (error) {
                                notify(error.message || "Unable to convert purchase", true);
                            }
                        }
                    });
                }

                // Purchase receipt upload/view/remove (edit-purchase modal)
                if ($("#purchaseReceiptFileInput")) {
                    $("#purchaseReceiptFileInput").addEventListener("change", updatePurchaseReceiptFileName);
                }
                if ($("#uploadPurchaseReceiptBtn")) {
                    $("#uploadPurchaseReceiptBtn").addEventListener("click", async () => {
                        const fileInput = $("#purchaseReceiptFileInput");
                        if (!fileInput.files.length) {
                            notify("Choose a file first", true);
                            return;
                        }
                        if (!window.editingPurchaseId) {
                            notify("Save the purchase before attaching a receipt", true);
                            return;
                        }
                        try {
                            await uploadReceiptFile(
                                "purchases",
                                window.editingPurchaseId,
                                fileInput.files[0],
                            );
                            notify("Receipt uploaded!");
                            fileInput.value = "";
                            updatePurchaseReceiptFileName();
                            showPurchaseReceiptState(true);
                            await loadPurchases();
                        } catch (error) {
                            notify(error.message || "Unable to upload receipt", true);
                        }
                    });
                }
                if ($("#removePurchaseReceiptBtn")) {
                    $("#removePurchaseReceiptBtn").addEventListener("click", async () => {
                        if (!window.editingPurchaseId) return;
                        if (!confirm("Remove this receipt?")) return;
                        try {
                            await apiCall(`/purchases/${window.editingPurchaseId}/receipt`, {
                                method: "DELETE",
                            });
                            notify("Receipt removed");
                            showPurchaseReceiptState(false);
                            await loadPurchases();
                        } catch (error) {
                            notify("Unable to remove receipt", true);
                        }
                    });
                }
                if ($("#viewPurchaseReceiptLink")) {
                    $("#viewPurchaseReceiptLink").addEventListener("click", (e) => {
                        e.preventDefault();
                        if (window.editingPurchaseId) openReceiptFor("purchases", window.editingPurchaseId);
                    });
                }

                // Recurring modal controls
                $("#manageRecurringBtn").addEventListener("click", () => {
                    fillRecurringCategoryOptions();
                    $("#recurringStartDate").value = new Date().toISOString().slice(0, 10);
                    loadRecurring();
                    $("#recurringModal").classList.remove("hidden");
                });

                $("#closeRecurringModal").addEventListener("click", () =>
                    $("#recurringModal").classList.add("hidden"),
                );

                $("#recurringForm").addEventListener("submit", async (e) => {
                    e.preventDefault();
                    const amountPaid = toNumber($("#recurringAmountPaid").value);
                    const balanceDue = toNumber($("#recurringBalanceDue").value) || 0;
                    if (isNaN(amountPaid) || amountPaid < 0) {
                        notify("Amount paid must be a positive number", true);
                        return;
                    }
                    try {
                        await apiCall("/recurring", {
                            method: "POST",
                            body: {
                                category: $("#recurringCategory").value,
                                frequency: $("#recurringFrequency").value,
                                recipient: $("#recurringRecipient").value,
                                description: $("#recurringDescription").value,
                                amount_paid: amountPaid,
                                balance_due: balanceDue,
                                start_date: $("#recurringStartDate").value,
                            },
                        });
                        notify("Recurring expense created!");
                        $("#recurringForm").reset();
                        $("#recurringStartDate").value = new Date().toISOString().slice(0, 10);
                        fillRecurringCategoryOptions();
                        await loadRecurring();
                    } catch (error) {
                        notify(error.message || "Error creating recurring expense", true);
                    }
                });

                $("#recurringTableBody").addEventListener("click", async (e) => {
                    if (e.target.matches(".toggle-recurring")) {
                        const id = e.target.dataset.id;
                        const isActive = e.target.dataset.active === "1";
                        try {
                            await apiCall(`/recurring/${id}`, {
                                method: "PUT",
                                body: { active: !isActive },
                            });
                            notify(isActive ? "Recurring expense paused" : "Recurring expense resumed");
                            await loadRecurring();
                        } catch (error) {
                            notify("Error updating recurring expense", true);
                        }
                    } else if (e.target.matches(".delete-recurring")) {
                        const id = e.target.dataset.id;
                        if (!confirm("Remove this recurring expense template? Already-generated expenses are not affected.")) return;
                        try {
                            await apiCall(`/recurring/${id}`, { method: "DELETE" });
                            notify("Recurring expense removed");
                            await loadRecurring();
                        } catch (error) {
                            notify("Error removing recurring expense", true);
                        }
                    }
                });

                // Categories modal controls
                $("#manageCategoriesBtn").addEventListener("click", () => {
                    renderCategoriesList();
                    $("#categoriesModal").classList.remove("hidden");
                });

                $("#closeCategoriesModal").addEventListener("click", () =>
                    $("#categoriesModal").classList.add("hidden"),
                );

                $("#categoryForm").addEventListener("submit", async (e) => {
                    e.preventDefault();
                    const name = $("#newCategoryName").value.trim();
                    if (!name) return;
                    await addCategory(name);
                    $("#newCategoryName").value = "";
                });

                $("#categoriesList").addEventListener("click", async (e) => {
                    const btn = e.target.closest(".delete-category");
                    if (!btn) return;
                    const category = btn.dataset.category;
                    if (category) await deleteCategory(category);
                });

                // Delegated actions for expenses (edit/delete)
                const expenseTBody =
                    document.querySelector("#expenseTableBody");
                if (expenseTBody) {
                    expenseTBody.addEventListener("click", (e) => {
                        const btn = e.target.closest(
                            ".edit-expense, .delete-expense",
                        );
                        if (!btn) return;
                        const id = btn.dataset.id;
                        if (!id) return;
                        if (btn.classList.contains("edit-expense")) {
                            window.editExpense(id);
                        } else if (btn.classList.contains("delete-expense")) {
                            window.deleteExpense(id);
                        }
                    });
                }

                // Export dropdown toggle
                const exportDropdown = $("#exportDropdown");
                $("#exportBtn").addEventListener("click", (e) => {
                    e.stopPropagation();
                    exportDropdown.classList.toggle("hidden");
                });
                // Close dropdown when clicking outside
                document.addEventListener("click", (e) => {
                    if (!e.target.closest(".export-dropdown-container")) {
                        exportDropdown.classList.add("hidden");
                    }
                });

                // Alerts bell dropdown toggle
                const alertsDropdown = $("#alertsDropdown");
                const alertsBellBtn = $("#alertsBellBtn");
                if (alertsBellBtn && alertsDropdown) {
                    alertsBellBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        alertsDropdown.classList.toggle("hidden");
                    });
                    document.addEventListener("click", (e) => {
                        if (!e.target.closest(".alerts-bell-wrap")) {
                            alertsDropdown.classList.add("hidden");
                        }
                    });
                }

                // Helper: Get export data from server (all pages, not just current page)
                async function getExportData() {
                    // sortBy always has a value; only flag real user-set filters
                    const realFilters = Object.entries(filters).filter(
                        ([k, v]) => v && !(k === "sortBy" && v === "date_desc"),
                    );
                    const hasActiveFilters = realFilters.length > 0;
                    let exportType = "all";

                    if (hasActiveFilters) {
                        const choice = confirm(
                            "You have active filters.\n\n" +
                                "Click OK to export only filtered expenses.\n" +
                                "Click Cancel to export ALL expenses.",
                        );
                        if (choice) exportType = "filtered";
                    }

                    // Fetch all matching records from server (no pagination limit)
                    let dataToExport;
                    try {
                        if (exportType === "filtered") {
                            dataToExport = await apiCall(`/expenses${buildExpenseQuery()}`);
                        } else {
                            dataToExport = await apiCall("/expenses");
                        }
                        if (!Array.isArray(dataToExport)) dataToExport = dataToExport.items || [];
                    } catch (err) {
                        dataToExport = expenses; // fallback to current page
                    }

                    return { dataToExport, exportType, hasActiveFilters };
                }

                // Convert expenses to CSV
                function expensesToCsv(expenseList) {
                    if (!expenseList || expenseList.length === 0) {
                        return "";
                    }
                    // Define CSV columns
                    const columns = [
                        "id", "description", "category", "type", "date_time",
                        "amount_due", "amount_paid", "balance_due", "status",
                        "notes", "created_at"
                    ];
                    // Escape CSV values
                    const escapeCsv = (val) => {
                        if (val === null || val === undefined) return "";
                        const str = String(val);
                        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
                            return '"' + str.replace(/"/g, '""') + '"';
                        }
                        return str;
                    };
                    // Build CSV
                    const header = columns.join(",");
                    const rows = expenseList.map((exp) =>
                        columns.map((col) => escapeCsv(exp[col])).join(",")
                    );
                    return header + "\n" + rows.join("\n");
                }

                // JSON Export
                $("#exportJsonBtn").addEventListener("click", async () => {
                    exportDropdown.classList.add("hidden");
                    const { dataToExport, exportType, hasActiveFilters } = await getExportData();

                    const data = {
                        expenses: dataToExport,
                        blogPosts: blogPosts,
                        exportedAt: new Date().toISOString(),
                        exportType: exportType,
                        appliedFilters: hasActiveFilters ? filters : null,
                        user: appCurrentUser
                            ? appCurrentUser.email || appCurrentUser.uid
                            : "anonymous",
                    };

                    const blob = new Blob([JSON.stringify(data, null, 2)], {
                        type: "application/json",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    const suffix = exportType === "filtered" ? "-filtered" : "";
                    a.download = `expense-tracker-export${suffix}-${new Date().toISOString().split("T")[0]}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                    notify(
                        `${exportType === "filtered" ? "Filtered" : "All"} data exported as JSON!`,
                    );
                });

                // CSV Export
                $("#exportCsvBtn").addEventListener("click", async () => {
                    exportDropdown.classList.add("hidden");
                    const { dataToExport, exportType } = await getExportData();

                    const csvContent = expensesToCsv(dataToExport);
                    if (!csvContent) {
                        notify("No expenses to export.", true);
                        return;
                    }

                    const blob = new Blob([csvContent], {
                        type: "text/csv;charset=utf-8;",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    const suffix = exportType === "filtered" ? "-filtered" : "";
                    a.download = `expenses-export${suffix}-${new Date().toISOString().split("T")[0]}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    notify(
                        `${exportType === "filtered" ? "Filtered" : "All"} expenses exported as CSV!`,
                    );
                });

                // ── Trash modal ──
                $("#trashBtn").addEventListener("click", () => loadTrash());
                $("#closeTrashModal").addEventListener("click", () =>
                    $("#trashModal").classList.add("hidden"),
                );
                $("#trashModal").addEventListener("click", (e) => {
                    if (e.target === $("#trashModal")) $("#trashModal").classList.add("hidden");
                });
                $("#trashList").addEventListener("click", async (e) => {
                    const restoreBtn = e.target.closest(".trash-restore-btn");
                    const permBtn = e.target.closest(".trash-perm-btn");
                    if (restoreBtn) {
                        const id = restoreBtn.dataset.id;
                        try {
                            await apiCall(`/expenses/${encodeURIComponent(id)}/restore`, { method: "POST" });
                            notify("Expense restored!");
                            await loadTrash();
                            await loadData();
                        } catch (err) {
                            notify(err?.message || "Failed to restore expense", true);
                        }
                    } else if (permBtn) {
                        const id = permBtn.dataset.id;
                        if (!confirm("Permanently delete this expense? This cannot be undone.")) return;
                        try {
                            await apiCall(`/expenses/${encodeURIComponent(id)}/permanent`, { method: "DELETE" });
                            notify("Expense permanently deleted.");
                            await loadTrash();
                        } catch (err) {
                            notify(err?.message || "Failed to delete expense", true);
                        }
                    }
                });

                // ── Settings modal ──
                $("#settingsBtn").addEventListener("click", () => {
                    $("#cpError").classList.add("hidden");
                    $("#changePasswordForm").reset();
                    $("#settingsModal").classList.remove("hidden");
                });
                $("#closeSettingsModal").addEventListener("click", () =>
                    $("#settingsModal").classList.add("hidden"),
                );
                $("#settingsModal").addEventListener("click", (e) => {
                    if (e.target === $("#settingsModal")) $("#settingsModal").classList.add("hidden");
                });
                $("#changePasswordForm").addEventListener("submit", async (e) => {
                    e.preventDefault();
                    const current = $("#cpCurrentPassword").value;
                    const newPw = $("#cpNewPassword").value;
                    const confirm2 = $("#cpConfirmPassword").value;
                    const errEl = $("#cpError");
                    errEl.classList.add("hidden");

                    if (newPw !== confirm2) {
                        errEl.textContent = "New passwords do not match.";
                        errEl.classList.remove("hidden");
                        return;
                    }
                    if (newPw.length < 8) {
                        errEl.textContent = "New password must be at least 8 characters.";
                        errEl.classList.remove("hidden");
                        return;
                    }
                    try {
                        await apiCall("/users/password", {
                            method: "PUT",
                            body: { currentPassword: current, newPassword: newPw },
                        });
                        notify("Password changed successfully!");
                        $("#settingsModal").classList.add("hidden");
                        $("#changePasswordForm").reset();
                    } catch (err) {
                        errEl.textContent = err?.message || "Failed to change password.";
                        errEl.classList.remove("hidden");
                    }
                });
            });


            // Advanced filters toggle
            document.addEventListener("DOMContentLoaded", () => {
                const toggleBtn = document.getElementById("toggleAdvancedFilters");
                const panel = document.getElementById("advancedFilters");
                if (toggleBtn && panel) {
                    toggleBtn.addEventListener("click", () => {
                        const open = panel.classList.toggle("hidden") === false;
                        toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
                    });
                }

                // Mobile nav
                const sidebar = document.getElementById("appSidebar");
                let backdrop = document.querySelector(".sidebar-backdrop");
                if (!backdrop) {
                    backdrop = document.createElement("div");
                    backdrop.className = "sidebar-backdrop";
                    document.body.appendChild(backdrop);
                }
                const closeSidebar = () => {
                    sidebar && sidebar.classList.remove("open");
                    backdrop.classList.remove("open");
                };
                const openSidebar = () => {
                    sidebar && sidebar.classList.add("open");
                    backdrop.classList.add("open");
                };
                backdrop.addEventListener("click", closeSidebar);

                document.querySelectorAll(".mobile-nav-btn[data-view]").forEach((btn) => {
                    btn.addEventListener("click", () => {
                        const view = btn.getAttribute("data-view");
                        document.querySelectorAll(".mobile-nav-btn[data-view]").forEach((b) => b.classList.remove("active"));
                        btn.classList.add("active");
                        const sideBtn = document.querySelector(`.sidebar-nav-btn[data-view="${view}"]`);
                        if (sideBtn) sideBtn.click();
                        closeSidebar();
                    });
                });
                const mobileAdd = document.getElementById("mobileAddExpenseBtn");
                if (mobileAdd) {
                    mobileAdd.addEventListener("click", () => {
                        const addBtn = document.getElementById("addExpenseBtn");
                        if (addBtn) addBtn.click();
                    });
                }
                const mobileMenu = document.getElementById("mobileMenuBtn");
                if (mobileMenu) {
                    mobileMenu.addEventListener("click", () => {
                        if (sidebar && sidebar.classList.contains("open")) closeSidebar();
                        else openSidebar();
                    });
                }
            });
