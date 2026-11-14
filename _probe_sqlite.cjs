try {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE t (a TEXT, b TEXT, c TEXT)");
  const ins = db.prepare("INSERT INTO t (a,b,c) VALUES (?,?,?)");
  const trial = (label, fn) => {
    try { fn(); console.log(label, "=> OK"); }
    catch (e) { console.log(label, "=> ERR:", e.message); }
  };
  trial("positional (a,b,c)", () => ins.run("x", "y", "z"));
  trial("array [a,b,c]", () => ins.run(["p", "q", "r"]));
  trial("named {$1,$2,$3}", () => ins.run({ $1: "m", $2: "n", $3: "o" }));
  trial("named {:1,:2,:3}", () => ins.run({ ":1": "g", ":2": "h", ":3": "i" }));
  trial("named {@1,@2,@3}", () => ins.run({ "@1": "u", "@2": "v", "@3": "w" }));
  const q = db.prepare("SELECT a,b,c FROM t WHERE a=?");
  trial("get positional", () => q.get("x"));
  trial("get {$1}", () => q.get({ $1: "x" }));
  trial("get {:1}", () => q.get({ ":1": "x" }));
} catch (e) {
  console.log("load err", e.message);
}
