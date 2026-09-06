/* ============================================================
 *  JarvisRide ストア
 *
 *  配車データの置き場所を抽象化する。
 *    LocalStore    … localStorage + BroadcastChannel（同一端末のタブ間のみ）
 *    SupabaseStore … Supabase + Realtime（端末をまたいでマッチング）
 *
 *  どちらも「読み取りは同期・書き込みは非同期」で揃える。
 *  読み取りはメモリ上のキャッシュから返し、キャッシュは
 *  Realtime / storage イベントで最新に保たれる。
 * ============================================================ */
(function (global) {
  "use strict";

  var LS_RIDES = "jr.rides";
  var LS_UID   = "jr.uid";
  var MAX_KEEP = 40;

  function newId() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /* ---------------- 共通の土台 ---------------- */

  function Base() {
    this.mode = "local";
    this.userId = null;
    this.cache = {};
    this.listeners = [];
  }
  Base.prototype.onChange = function (cb) { this.listeners.push(cb); };
  Base.prototype.emit = function () {
    for (var i = 0; i < this.listeners.length; i++) {
      try { this.listeners[i](); } catch (e) { console.error(e); }
    }
  };
  Base.prototype.get = function (id) { return this.cache[id] || null; };
  Base.prototype.list = function () {
    var out = [], k;
    for (k in this.cache) if (Object.prototype.hasOwnProperty.call(this.cache, k)) out.push(this.cache[k]);
    out.sort(function (a, b) { return a.createdAt - b.createdAt; });
    return out;
  };
  /** 通信せずキャッシュだけ更新する（走行アニメーションなど高頻度の更新用） */
  Base.prototype.patchLocal = function (id, fields) {
    var r = this.cache[id];
    if (!r) return null;
    for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) r[k] = fields[k];
    this.emit();
    return r;
  };
  Base.prototype.newRide = function (fields) {
    var r = {
      id: newId(),
      createdAt: Date.now(),
      status: "searching",
      car: null,
      eta: 0,
      driver: null,
      riderId: this.userId,
      driverId: null
    };
    for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) r[k] = fields[k];
    return r;
  };

  /* ---------------- ローカル（単一端末） ---------------- */

  function LocalStore() {
    Base.call(this);
    this.mode = "local";
    this.userId = this.deviceId();
    this.chan = null;
    this.reload();

    var self = this;
    try {
      this.chan = new BroadcastChannel("jarvisride");
      this.chan.onmessage = function () { self.reload(); self.emit(); };
    } catch (e) { /* 非対応ブラウザは storage イベントのみで同期する */ }
    global.addEventListener("storage", function (e) {
      if (e.key === LS_RIDES) { self.reload(); self.emit(); }
    });
  }
  LocalStore.prototype = Object.create(Base.prototype);
  LocalStore.prototype.constructor = LocalStore;

  LocalStore.prototype.deviceId = function () {
    var v = null;
    try { v = localStorage.getItem(LS_UID); } catch (e) {}
    if (!v) {
      v = newId();
      try { localStorage.setItem(LS_UID, v); } catch (e) {}
    }
    return v;
  };
  LocalStore.prototype.reload = function () {
    var arr = [];
    try {
      var raw = localStorage.getItem(LS_RIDES);
      arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) arr = [];
    } catch (e) { arr = []; }
    this.cache = {};
    for (var i = 0; i < arr.length; i++) this.cache[arr[i].id] = arr[i];
  };
  LocalStore.prototype.flush = function () {
    var all = this.list();
    if (all.length > MAX_KEEP) all = all.slice(all.length - MAX_KEEP);
    try { localStorage.setItem(LS_RIDES, JSON.stringify(all)); } catch (e) {}
    if (this.chan) { try { this.chan.postMessage(Date.now()); } catch (e) {} }
  };
  LocalStore.prototype.init = function () { return Promise.resolve(this); };
  LocalStore.prototype.refresh = function () {
    this.reload();
    this.emit();
    return Promise.resolve();
  };
  LocalStore.prototype.create = function (fields) {
    var r = this.newRide(fields);
    this.cache[r.id] = r;
    this.flush();
    this.emit();
    return Promise.resolve(r);
  };
  LocalStore.prototype.patch = function (id, fields) {
    this.reload();
    var r = this.patchLocal(id, fields);
    if (r) this.flush();
    return Promise.resolve(r);
  };
  LocalStore.prototype.claim = function (id, driver, car) {
    this.reload();
    var r = this.cache[id];
    if (!r || r.status !== "searching" || r.driverId) { this.emit(); return Promise.resolve(null); }
    r.status = "enroute";
    r.driver = driver;
    r.driverId = this.userId;
    r.car = car;
    this.flush();
    this.emit();
    return Promise.resolve(r);
  };

  /* ---------------- Supabase（端末間） ---------------- */

  var COLS = "id,created_at,status,cls,pickup,dest,car,driver,km,base,pickup_fee,total,eta,rider_id,driver_id";

  function fromRow(row) {
    return {
      id: row.id,
      createdAt: new Date(row.created_at).getTime(),
      status: row.status,
      cls: row.cls,
      pickup: row.pickup,
      dest: row.dest,
      car: row.car,
      driver: row.driver,
      km: Number(row.km),
      base: Number(row.base),
      pickupFee: Number(row.pickup_fee),
      total: Number(row.total),
      eta: row.eta,
      riderId: row.rider_id,
      driverId: row.driver_id
    };
  }
  var TO_COL = {
    id: "id", status: "status", cls: "cls", pickup: "pickup", dest: "dest",
    car: "car", driver: "driver", km: "km", base: "base", pickupFee: "pickup_fee",
    total: "total", eta: "eta", riderId: "rider_id", driverId: "driver_id"
  };
  function toRow(fields) {
    var out = {};
    for (var k in fields) {
      if (Object.prototype.hasOwnProperty.call(fields, k) && TO_COL[k]) out[TO_COL[k]] = fields[k];
    }
    return out;
  }

  function SupabaseStore(url, key) {
    Base.call(this);
    this.mode = "supabase";
    this.url = url;
    this.key = key;
    this.client = null;
  }
  SupabaseStore.prototype = Object.create(Base.prototype);
  SupabaseStore.prototype.constructor = SupabaseStore;

  SupabaseStore.prototype.init = function () {
    var self = this;
    if (!global.supabase || !global.supabase.createClient) {
      return Promise.reject(new Error("supabase-js が読み込まれていません"));
    }
    this.client = global.supabase.createClient(this.url, this.key, {
      auth: { persistSession: true, autoRefreshToken: true }
    });

    return this.client.auth.getSession()
      .then(function (res) {
        if (res.data && res.data.session) return res.data.session;
        return self.client.auth.signInAnonymously().then(function (r) {
          if (r.error) throw r.error;
          return r.data.session;
        });
      })
      .then(function (session) {
        if (!session || !session.user) throw new Error("匿名サインインに失敗しました");
        self.userId = session.user.id;
        return self.refresh();
      })
      .then(function () { self.subscribe(); return self; });
  };

  /** 参照できる配車（自分の配車 + 受付中のリクエスト）を取り込む */
  SupabaseStore.prototype.refresh = function () {
    var self = this;
    return this.client
      .from("rides").select(COLS)
      .order("created_at", { ascending: true })
      .limit(MAX_KEEP)
      .then(function (res) {
        if (res.error) throw res.error;
        self.cache = {};
        (res.data || []).forEach(function (row) { self.cache[row.id] = fromRow(row); });
        self.emit();
      });
  };

  SupabaseStore.prototype.subscribe = function () {
    var self = this;
    this.channel = this.client
      .channel("jarvisride-rides")
      .on("postgres_changes", { event: "*", schema: "public", table: "rides" }, function (payload) {
        if (payload.eventType === "DELETE") {
          if (payload.old && payload.old.id) delete self.cache[payload.old.id];
        } else if (payload.new && payload.new.id) {
          self.cache[payload.new.id] = fromRow(payload.new);
        }
        self.emit();
      })
      .subscribe();
  };

  SupabaseStore.prototype.create = function (fields) {
    var self = this;
    var r = this.newRide(fields);
    this.cache[r.id] = r;          // 楽観的に反映してから送信する
    this.emit();
    var row = toRow(r);
    row.created_at = new Date(r.createdAt).toISOString();
    return this.client.from("rides").insert(row).select(COLS).single()
      .then(function (res) {
        if (res.error) throw res.error;
        self.cache[res.data.id] = fromRow(res.data);
        self.emit();
        return self.cache[res.data.id];
      })
      .catch(function (err) {
        delete self.cache[r.id];
        self.emit();
        throw err;
      });
  };

  SupabaseStore.prototype.patch = function (id, fields) {
    var self = this;
    this.patchLocal(id, fields);   // 手元の表示は即座に更新する
    return this.client.from("rides").update(toRow(fields)).eq("id", id).select(COLS)
      .then(function (res) {
        if (res.error) throw res.error;
        var row = res.data && res.data[0];
        if (row) { self.cache[row.id] = fromRow(row); self.emit(); }
        return row ? self.cache[row.id] : null;
      });
  };

  /**
   * 受付中で未割当のリクエストだけを自分に割り当てる。
   * 条件付き UPDATE なので、他のドライバーが先に受諾していれば 0 行が返り null になる。
   */
  SupabaseStore.prototype.claim = function (id, driver, car) {
    var self = this;
    return this.client
      .from("rides")
      .update({ status: "enroute", driver: driver, driver_id: this.userId, car: car })
      .eq("id", id).eq("status", "searching").is("driver_id", null)
      .select(COLS)
      .then(function (res) {
        if (res.error) throw res.error;
        var row = res.data && res.data[0];
        if (!row) {
          // 先を越された。この行はもう参照権がなく更新も届かないので手元から消す
          delete self.cache[id];
          self.emit();
          return null;
        }
        self.cache[row.id] = fromRow(row);
        self.emit();
        return self.cache[row.id];
      });
  };

  /* ---------------- 生成 ---------------- */

  /**
   * 設定があれば Supabase、なければ（あるいは接続に失敗すれば）ローカルで起動する。
   * 失敗しても必ずストアを返し、アプリ全体が止まらないようにする。
   */
  function createStore(cfg, onFallback) {
    var url = cfg && cfg.SUPABASE_URL, key = cfg && cfg.SUPABASE_ANON_KEY;
    if (!url || !key) return new LocalStore().init();

    var s = new SupabaseStore(url, key);
    return s.init().catch(function (err) {
      console.error("Supabase への接続に失敗しました:", err);
      if (onFallback) onFallback(err);
      return new LocalStore().init();
    });
  }

  global.JRStore = { create: createStore, LocalStore: LocalStore, SupabaseStore: SupabaseStore };
})(window);
