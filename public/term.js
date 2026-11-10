/**
 * Mail Agent terminal (/term). Plain commands over the existing public API:
 * POST /v1/inboxes, GET /v1/inboxes/:id/wait, GET /v1/inboxes/:id/extract, and so on.
 * Output is plain text, so a person and an agent driving a browser read the same thing.
 */
(function (root) {
  const KEY_STORAGE = "mailagent_dashboard_key";
  const BASE_STORAGE = "mailagent_api_base";
  const INBOX_STORAGE = "mailagent_term_inbox";

  const COMMANDS = [
    ["help", "", "list commands"],
    ["key", "<ma_key>", "save your API key in this browser"],
    ["whoami", "", "plan, usage, limits", "GET /v1/me"],
    ["new", "[label]", "create an inbox and select it", "POST /v1/inboxes"],
    ["ls", "", "list your inboxes", "GET /v1/inboxes"],
    ["use", "<id|address>", "select an inbox"],
    ["wait", "[seconds]", "wait for mail, then show the code or link", "GET /v1/inboxes/:id/wait"],
    ["read", "", "show the code or link from the latest email", "GET /v1/inboxes/:id/extract"],
    ["mail", "", "list emails in the selected inbox", "GET /v1/inboxes/:id/messages"],
    ["sim", "[scenario]", "inject a test email (otp, magic_link, ...)", "POST /v1/inboxes/:id/simulate"],
    ["rm", "[id]", "delete an inbox", "DELETE /v1/inboxes/:id"],
    ["get-key", "<email>", "email me a free API key", "POST /v1/keys/request"],
    ["replace-key", "<email>", "leaked key? email a link that revokes it and gives a new one", "POST /v1/keys/rotate/request"],
    ["upgrade", "", "Pro plan, $29/month"],
    ["json", "", "toggle raw JSON output"],
    ["logout", "", "forget the key in this browser"],
    ["clear", "", "clear the screen"],
  ];
  const NAMES = COMMANDS.map((c) => c[0]);

  const ERRORS = {
    unauthorized: "Key rejected. Paste a valid key, or run: replace-key you@company.com",
    invalid_api_key: "Key rejected. Paste a valid key, or run: replace-key you@company.com",
    inbox_limit_reached: "Inbox limit reached for your plan. Delete one with rm, or run upgrade.",
    inbox_not_found: "Inbox not found. Run ls.",
    no_messages: "No email yet. Run wait.",
    rate_limit_exceeded: "Too many requests. Try again in a minute.",
    insufficient_scope: "This key is read-only for that action.",
    invalid_email: "Enter a valid work email.",
    inbox_domain_not_allowed: "Use your own work email, not a Mail Agent inbox.",
    disposable_email: "Disposable email addresses are not accepted.",
    email_not_deliverable: "This domain does not accept email.",
    key_limit_reached: "This email already has the maximum number of keys.",
    account_suspended: "Account suspended for mail that looks like signups on other sites. Write to hello@webmailagent.com.",
  };

  /** Split a command line into name and args. Quotes group words. */
  function parseLine(line) {
    const parts = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(String(line || "")))) parts.push(m[1] ?? m[2] ?? m[3]);
    const name = (parts.shift() || "").toLowerCase();
    return { name, args: parts };
  }

  /** A pasted key on its own line means "key <that key>". Keeps the key's original case. */
  function resolveLine(line) {
    const trimmed = String(line || "").trim();
    if (/^ma_[A-Za-z0-9_-]{6,}$/.test(trimmed)) return { name: "key", args: [trimmed] };
    return parseLine(trimmed);
  }

  /** Start and end of a key, the rest as stars: ma_PSd*************************My6o. */
  function maskKey(k) {
    return k.slice(0, 6) + "*".repeat(Math.max(3, k.length - 10)) + k.slice(-4);
  }

  /** Never print a key in full. */
  function maskKeys(text) {
    return String(text || "").replace(/\bma_[A-Za-z0-9_-]{6,}/gi, maskKey);
  }

  /**
   * The input box never shows a full key either (screen recordings, demos).
   * Full keys in `value` become masks; `keys` remembers mask -> key for submit.
   */
  function hideKeysInInput(value, keys) {
    return String(value || "").replace(/\bma_[A-Za-z0-9_-]{32}\b/g, (k) => {
      const m = maskKey(k);
      keys.set(m, k);
      return m;
    });
  }

  /** Put the real keys back before the line runs. */
  function revealKeysInInput(value, keys) {
    let v = String(value || "");
    for (const [m, k] of keys) v = v.split(m).join(k);
    return v;
  }

  /** Same priority as agent.primaryAction on the server: OTP, then link. */
  function primaryAction(v) {
    if (!v) return null;
    if (v.otp) return { type: "otp", value: String(v.otp) };
    if (v.primaryLink) return { type: "magic_link", value: String(v.primaryLink) };
    if (Array.isArray(v.links) && v.links.length) return { type: "link", value: String(v.links[0]) };
    return { type: "manual", value: null };
  }

  function completions(prefix) {
    const p = String(prefix || "").toLowerCase();
    return NAMES.filter((n) => n.startsWith(p));
  }

  function errorText(status, json) {
    const code = json && json.error;
    if (code && ERRORS[code]) return ERRORS[code];
    if (status === 401) return ERRORS.unauthorized;
    if (status === 408) return "No email yet. Run wait again.";
    if (status === 429) return code === "inbox_limit_reached" ? ERRORS.inbox_limit_reached : ERRORS.rate_limit_exceeded;
    return (code ? code : "HTTP " + status) + (json && json.hint ? ". " + json.hint : "");
  }

  /** What to do with a new key after GET /v1/me: save it, refuse it, or save it unchecked (server or network trouble). */
  function keyCheckDecision(status) {
    if (status >= 200 && status < 300) return "save";
    if (status === 401 || status === 403) return "reject";
    return "unchecked";
  }

  /** Run lines one at a time in the order they came in. Lines typed during a command wait their turn. */
  function createQueue(runLine) {
    const lines = [];
    let running = false;
    async function drain() {
      running = true;
      try {
        while (lines.length) await runLine(lines.shift());
      } finally {
        running = false;
      }
    }
    return {
      push(line) {
        lines.push(line);
        if (!running) return drain();
        return undefined;
      },
      /** Drop lines that have not started yet. Returns how many were dropped. */
      clear() {
        const n = lines.length;
        lines.length = 0;
        return n;
      },
      get pending() {
        return lines.length;
      },
      get running() {
        return running;
      },
    };
  }

  const core = { COMMANDS, parseLine, primaryAction, completions, errorText, createQueue, keyCheckDecision, resolveLine, maskKeys, maskKey, hideKeysInInput, revealKeysInInput };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = core;
    return;
  }
  root.MailAgentTerm = core;

  /* ---------- browser UI ---------- */
  const screen = document.getElementById("screen");
  const out = document.getElementById("out");
  const form = document.getElementById("form");
  const input = document.getElementById("cmd");
  if (!screen || !out || !form || !input) return;

  const DEFAULT_BASE = screen.dataset.api;
  const store = {
    get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
    set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* private mode */ } },
  };
  const state = {
    json: false,
    inbox: (() => { try { return JSON.parse(store.get(INBOX_STORAGE) || "null"); } catch { return null; } })(),
    history: [],
    hIndex: 0,
    busy: null,
  };

  const base = () => (store.get(BASE_STORAGE) || DEFAULT_BASE).replace(/\/$/, "");
  const key = () => store.get(KEY_STORAGE).trim();
  const keyHint = (k) => (k.length > 10 ? maskKey(k) : "set");

  /** print(["dim", "text"], " plain ", ["val", "x", {copy: true}]) */
  function print(...parts) {
    const line = document.createElement("div");
    line.className = "line";
    for (const p of parts) {
      if (p == null) continue;
      if (typeof p === "string") { line.append(p); continue; }
      const [cls, text, opts] = p;
      const el = document.createElement(opts && opts.href ? "a" : "span");
      if (cls) el.className = cls;
      el.textContent = text;
      if (opts && opts.href) { el.href = opts.href; el.target = "_blank"; el.rel = "noopener noreferrer"; }
      if (opts && opts.copy) {
        el.classList.add("copy");
        el.title = "copy";
        el.tabIndex = 0;
        const copy = () => copyText(text);
        el.addEventListener("click", copy);
        el.addEventListener("keydown", (e) => { if (e.key === "Enter") copy(); });
      }
      line.append(el);
    }
    out.append(line);
    screen.scrollTop = screen.scrollHeight;
    return line;
  }
  const dim = (t) => ["dim", t];
  const row = (label, value, cls, opts) => print(dim(label.padEnd(9)), [cls || "", value, opts]);

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      print(dim("copied"));
    } catch {
      print(dim("copy failed, select the text instead"));
    }
  }

  function setInbox(inbox) {
    state.inbox = inbox ? { id: inbox.id, address: inbox.address } : null;
    store.set(INBOX_STORAGE, state.inbox ? JSON.stringify(state.inbox) : "");
  }

  async function api(method, path, body, signal, withKey) {
    const headers = { Accept: "application/json" };
    const k = withKey || key();
    if (k) headers.Authorization = "Bearer " + k;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(base() + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const json = await res.json().catch(() => ({}));
    if (state.json) print(dim(method + " " + path + "  " + res.status), "\n", JSON.stringify(json, null, 2));
    return { ok: res.ok, status: res.status, json };
  }

  function needKey() {
    if (key()) return false;
    print(["err", "No API key."], " Run ", ["hi", "key ma_..."], " or ", ["hi", "get-key you@company.com"]);
    return true;
  }

  function needInbox(arg) {
    if (arg) return arg;
    if (state.inbox) return state.inbox.id;
    print(["err", "No inbox selected."], " Run ", ["hi", "new"], " or ", ["hi", "use <id>"]);
    return null;
  }

  function fail(r) {
    print(["err", errorText(r.status, r.json)]);
  }

  function showAction(v) {
    const a = primaryAction(v);
    if (v.from) row("from", v.from);
    if (v.subject) row("subject", v.subject);
    if (!a || a.type === "manual") {
      row("action", "no code or link found, run json then read", "dim");
      return;
    }
    if (a.type === "otp") {
      print(dim("otp"));
      print(["big", a.value, { copy: true }]);
    } else {
      row(a.type === "magic_link" ? "link" : "link", a.value, "info", { copy: true });
    }
  }

  /** One line that says what to type next. */
  function next(cmd, what) {
    print(dim("next: "), ["hi", cmd], dim("  " + what));
  }

  function updatePlaceholder() {
    input.placeholder = key() ? "type a command, help lists all" : "paste your API key here";
  }

  function showMe(me) {
    const { plan, limits = {}, usage = {} } = me || {};
    row("plan", String(plan || "free"), "hi");
    row("inboxes", (usage.activeInboxes ?? "?") + "/" + (limits.maxActiveInboxes ?? "?"));
    if (limits.monthlyEmails != null) row("emails", (usage.emailsThisMonth ?? "?") + "/" + limits.monthlyEmails + " this month");
    row("rate", (limits.rateLimitPerMinute ?? "?") + " requests/min");
  }

  const run = {
    help() {
      for (const [name, args, desc, http] of COMMANDS) {
        print(["hi", (name + " " + args).trimEnd().padEnd(24)], ["", desc], http ? ["dim", "  " + http] : null);
      }
      print(dim("keys: tab completes, up and down walk history, ctrl+c stops wait, ctrl+l clears"));
      print(dim("api base " + base() + ", auth header: Authorization: Bearer ma_..."));
    },

    async key(args) {
      const k = (args[0] || "").trim();
      if (!k) {
        print(key() ? ["", "key " + keyHint(key())] : ["dim", "no key saved. Run: key ma_..."]);
        return;
      }
      if (!/^ma_/.test(k)) { print(["err", "Keys start with ma_"]); return; }
      // Check the key first; save it only if the server accepts it.
      const r = await api("GET", "/v1/me", undefined, undefined, k);
      const decision = keyCheckDecision(r.status);
      if (decision === "reject") {
        fail(r);
        print(dim(key() ? "not saved, still using " + keyHint(key()) : "not saved"));
        return;
      }
      store.set(KEY_STORAGE, k);
      print(["ok", "key saved"], dim("  " + keyHint(k) + ", stored in this browser only"));
      if (decision === "save") showMe(r.json);
      else print(dim("could not check the key now (HTTP " + r.status + "), run whoami later"));
      updatePlaceholder();
      next("new", "create an inbox");
    },

    async whoami() {
      if (needKey()) return;
      const r = await api("GET", "/v1/me");
      if (!r.ok) return fail(r);
      showMe(r.json);
    },

    async new(args) {
      if (needKey()) return;
      const label = args.join(" ").trim();
      const r = await api("POST", "/v1/inboxes", label ? { label } : {});
      if (!r.ok) return fail(r);
      setInbox(r.json);
      print(["hi", r.json.address, { copy: true }], dim("  " + r.json.id));
      next("sim otp", "send a test email with a code to this inbox");
      print(dim("      or use the address in your signup form, then run wait"));
    },

    async ls() {
      if (needKey()) return;
      const r = await api("GET", "/v1/inboxes?limit=50");
      if (!r.ok) return fail(r);
      const list = r.json.inboxes || [];
      if (!list.length) { print(dim("no inboxes. Run new")); return; }
      for (const i of list) {
        const mark = state.inbox && state.inbox.id === i.id ? ["ok", "* "] : "  ";
        print(mark, ["hi", i.address], dim("  " + i.id + (i.label ? "  " + i.label : "")));
      }
    },

    async use(args) {
      if (needKey()) return;
      const q = (args[0] || "").trim();
      if (!q) { print(state.inbox ? ["", state.inbox.address] : dim("no inbox selected")); return; }
      let id = q;
      if (q.includes("@")) {
        const r = await api("GET", "/v1/inboxes?limit=100");
        if (!r.ok) return fail(r);
        const hit = (r.json.inboxes || []).find((i) => i.address.toLowerCase() === q.toLowerCase());
        if (!hit) { print(["err", ERRORS.inbox_not_found]); return; }
        id = hit.id;
      }
      const r = await api("GET", "/v1/inboxes/" + encodeURIComponent(id));
      if (!r.ok) return fail(r);
      setInbox({ id, address: r.json.address });
      print(["ok", "using "], ["hi", r.json.address], dim("  " + (r.json.messageCount || 0) + " emails"));
    },

    async wait(args) {
      if (needKey()) return;
      const id = needInbox();
      if (!id) return;
      const sec = Math.max(5, Math.min(120, Number(args[0]) || 120));
      const ctrl = new AbortController();
      state.busy = ctrl;
      const status = print(dim("waiting up to " + sec + "s on " + (state.inbox ? state.inbox.address : id) + ", ctrl+c to stop"));
      try {
        const r = await api("GET", "/v1/inboxes/" + encodeURIComponent(id) + "/wait?timeout=" + sec, undefined, ctrl.signal);
        if (!r.ok) return fail(r);
        status.textContent = "";
        status.append(Object.assign(document.createElement("span"), { className: "ok", textContent: "mail received" }));
        await run.read();
      } catch (e) {
        if (e && e.name === "AbortError") print(dim("stopped"));
        else throw e;
      } finally {
        state.busy = null;
      }
    },

    async read() {
      if (needKey()) return;
      const id = needInbox();
      if (!id) return;
      const r = await api("GET", "/v1/inboxes/" + encodeURIComponent(id) + "/extract");
      if (!r.ok) return fail(r);
      showAction(r.json);
    },

    async mail() {
      if (needKey()) return;
      const id = needInbox();
      if (!id) return;
      const r = await api("GET", "/v1/inboxes/" + encodeURIComponent(id) + "/messages");
      if (!r.ok) return fail(r);
      const list = r.json.messages || [];
      if (!list.length) { print(dim("no email yet. Run wait")); return; }
      for (const m of list) {
        const when = String(m.receivedAt || m.received_at || "").replace("T", " ").slice(0, 16);
        print(dim(when.padEnd(18)), ["", String(m.from || m.from_addr || "").padEnd(28)], ["hi", " " + (m.subject || "")]);
      }
    },

    async sim(args) {
      if (needKey()) return;
      const id = needInbox();
      if (!id) return;
      const scenario = (args[0] || "otp").trim();
      const r = await api("POST", "/v1/inboxes/" + encodeURIComponent(id) + "/simulate", { scenario });
      if (!r.ok) {
        fail(r);
        const s = await api("GET", "/v1/inboxes/simulate/scenarios");
        if (s.ok) print(dim("scenarios: " + (s.json.scenarios || []).map((x) => x.id).join(", ")));
        return;
      }
      print(["ok", "test email injected"], dim("  " + scenario + ", no SMTP"));
      await run.read();
    },

    async rm(args) {
      if (needKey()) return;
      const id = needInbox((args[0] || "").trim());
      if (!id) return;
      const r = await api("DELETE", "/v1/inboxes/" + encodeURIComponent(id));
      if (!r.ok) return fail(r);
      if (state.inbox && state.inbox.id === id) setInbox(null);
      print(["ok", "deleted"], dim("  " + id));
    },

    async "get-key"(args) {
      const email = (args[0] || "").trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        print(["err", "Usage: get-key you@company.com"]);
        return;
      }
      const r = await api("POST", "/v1/keys/request", { email, website: "" });
      if (r.status !== 202) return fail(r);
      print(["ok", "check " + email], dim("  the link works once, for 30 minutes"));
      print(dim("the key opens on /get-key.html, then come back and run: key ma_..."));
    },

    async "replace-key"(args) {
      const email = (args[0] || "").trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        print(["err", "Usage: replace-key you@company.com"]);
        return;
      }
      const r = await api("POST", "/v1/keys/rotate/request", { email, website: "" });
      if (r.status !== 202) return fail(r);
      print(["ok", "check " + email], dim("  opening the link revokes your current keys"));
      print(dim("the new key opens on /get-key.html, then come back and run: key ma_..."));
    },

    upgrade() {
      print(["", "Pro: 100 inboxes, 5000 emails/month, $29/month  "], ["info", "/upgrade.html", { href: "/upgrade.html" }]);
    },

    json() {
      state.json = !state.json;
      print(dim("raw JSON " + (state.json ? "on" : "off")));
    },

    logout() {
      store.set(KEY_STORAGE, "");
      updatePlaceholder();
      setInbox(null);
      print(["ok", "key removed from this browser"]);
    },

    clear() {
      out.textContent = "";
    },
  };

  async function exec(line) {
    const trimmed = String(line || "").trim();
    print(["ok", "$ "], ["hi", maskKeys(trimmed)]);
    if (!trimmed) return;
    const { name, args } = resolveLine(trimmed);
    const fn = run[name];
    if (!fn) {
      const shown = maskKeys(name).slice(0, 32);
      const near = completions(name.slice(0, 2));
      print(["err", "unknown command: " + shown], near.length ? dim("  try " + near.join(", ")) : dim("  run help"));
      return;
    }
    try {
      await fn(args);
    } catch (e) {
      print(["err", "Network error. Check your connection and try again."]);
      if (state.json) print(dim(String(e && e.message)));
    }
  }

  // The input stays open while a command runs; new lines queue up behind it.
  const queue = createQueue(exec);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const line = revealKeysInInput(input.value, inputKeys);
    input.value = "";
    inputKeys.clear();
    if (line.trim()) {
      // Never keep keys in history.
      state.history.push(line.replace(/\bma_\S+/g, "ma_..."));
      state.hIndex = state.history.length;
    }
    queue.push(line);
  });

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "c" && (state.busy || queue.pending) && !window.getSelection().toString()) {
      e.preventDefault();
      const dropped = queue.clear();
      if (state.busy) state.busy.abort();
      if (dropped) print(dim("skipped " + dropped + " queued command" + (dropped > 1 ? "s" : "")));
      return;
    }
    if (e.ctrlKey && e.key === "l") {
      e.preventDefault();
      run.clear();
    }
  });

  // A pasted (or dropped, or autofilled) key shows as ma_PSd****My6o right away.
  const inputKeys = new Map();
  input.addEventListener("input", () => {
    const v = input.value;
    const hidden = hideKeysInInput(v, inputKeys);
    if (hidden !== v) {
      const end = input.selectionEnd === v.length;
      input.value = hidden;
      if (end) input.setSelectionRange(hidden.length, hidden.length);
    }
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (!state.history.length) return;
      e.preventDefault();
      state.hIndex = Math.max(0, Math.min(state.history.length, state.hIndex + (e.key === "ArrowUp" ? -1 : 1)));
      input.value = state.history[state.hIndex] || "";
    } else if (e.key === "Tab") {
      const v = input.value;
      if (v.includes(" ")) return;
      e.preventDefault();
      const hits = completions(v);
      if (hits.length === 1) input.value = hits[0] + " ";
      else if (hits.length > 1) print(dim(hits.join("  ")));
    }
  });

  document.querySelectorAll("[data-cmd]").forEach((b) =>
    b.addEventListener("click", () => {
      queue.push(b.dataset.cmd);
      input.focus();
    })
  );
  screen.addEventListener("click", (e) => {
    if (e.target === screen || e.target.closest(".wrap") === e.target) input.focus();
  });

  // Boot
  print(["hi", "mail agent"], dim("  inboxes for agents that test signups"));
  if (key()) {
    print(dim("key " + keyHint(key()) + (state.inbox ? ", inbox " + state.inbox.address : "")));
    if (state.inbox) next("sim otp", "test email to this inbox, or wait for real mail");
    else next("new", "create an inbox");
  } else {
    print(dim("1  get a free key:  "), ["hi", "get-key you@company.com"], dim("  or open "), ["info", "/get-key", { href: "/get-key" }]);
    print(dim("2  paste the key here and press enter"));
    print(dim("3  "), ["hi", "new"], dim(", then "), ["hi", "sim otp"], dim(": a test email, the code shows up here"));
  }
  updatePlaceholder();
  input.focus();
})(typeof window !== "undefined" ? window : globalThis);
