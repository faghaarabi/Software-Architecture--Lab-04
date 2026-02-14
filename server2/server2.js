// server2/server2.js
"use strict";

const http = require("http");
const { URL } = require("url");
const mysql = require("mysql2");

const CONFIG = {
  port: Number(process.env.PORT || 3000),
  corsAllowedOrigin: process.env.CORS_ORIGIN || "*",

  dbName: process.env.DB_NAME || "defaultdb",
  tableName: process.env.DB_TABLE || "patient",

  writer: {
    host: process.env.DB_WRITER_HOST || process.env.DB_HOST,
    port: Number(process.env.DB_WRITER_PORT || process.env.DB_PORT || 3306),
    user: process.env.DB_WRITER_USER || process.env.DB_USER,
    password: process.env.DB_WRITER_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.DB_WRITER_NAME || process.env.DB_NAME || "defaultdb",
  },

  reader: {
    host: process.env.DB_READER_HOST || process.env.DB_HOST,
    port: Number(process.env.DB_READER_PORT || process.env.DB_PORT || 3306),
    user: process.env.DB_READER_USER || process.env.DB_USER,
    password: process.env.DB_READER_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.DB_READER_NAME || process.env.DB_NAME || "defaultdb",
  },

  ssl: buildSslConfig(),
};

function buildSslConfig() {
  const ca = process.env.DB_SSL_CA;
  if (ca && ca.trim().length > 0) {
    return { ca, rejectUnauthorized: true };
  }
  return { rejectUnauthorized: true };
}

// ---- Define fixed rows to insert on each insert request
const FIXED_PATIENT_ROWS = [
  { name: "Alex", age: 22, city: "Vancouver" },
  { name: "Jack", age: 30, city: "Burnaby" },
  { name: "Rose", age: 28, city: "Richmond" },
];

// ---- Provide database helpers for table creation, inserts, and selects
class DbService {
  constructor(config, fixedRows) {
    this.config = config;
    this.fixedRows = fixedRows;
  }

  createConn(dbConfig) {
    return mysql.createConnection({
      ...dbConfig,
      ssl: this.config.ssl,
    });
  }

  ensureDbAndTable(writerConn, cb) {
    const useDbSql = `USE \`${this.config.dbName}\`;`;

    writerConn.query(useDbSql, (err) => {
      if (err) return cb(err);

      const createTableSql = `
        CREATE TABLE IF NOT EXISTS \`${this.config.tableName}\` (
          patientID INT NOT NULL AUTO_INCREMENT,
          name VARCHAR(100) NOT NULL,
          age INT NOT NULL,
          city VARCHAR(100) NOT NULL,
          PRIMARY KEY (patientID)
        ) ENGINE=InnoDB;
      `;

      writerConn.query(createTableSql, cb);
    });
  }

  insertFixedRows(cb) {
    const writerConn = this.createConn(this.config.writer);

    writerConn.connect((err) => {
      if (err) return cb(err);

      this.ensureDbAndTable(writerConn, (err2) => {
        if (err2) {
          writerConn.end();
          return cb(err2);
        }

        const sql = `INSERT INTO \`${this.config.tableName}\` (name, age, city) VALUES ?`;
        const values = this.fixedRows.map((p) => [p.name, p.age, p.city]);

        writerConn.query(sql, [values], (err3, result) => {
          writerConn.end();
          if (err3) return cb(err3);
          return cb(null, result);
        });
      });
    });
  }

  runSelect(sql, cb) {
    const readerConn = this.createConn(this.config.reader);

    readerConn.connect((err) => {
      if (err) return cb(err);

      readerConn.query(`USE \`${this.config.dbName}\`;`, (useErr) => {
        if (useErr) {
          readerConn.end();
          return cb(useErr);
        }

        readerConn.query(sql, (qErr, rows) => {
          readerConn.end();
          if (qErr) return cb(qErr);
          return cb(null, rows);
        });
      });
    });
  }
}

// ---- Provide HTTP helpers for CORS, JSON responses, and body reads
class HttpUtil {
  constructor(corsAllowedOrigin) {
    this.corsAllowedOrigin = corsAllowedOrigin;
  }

  writeCorsHeaders(res) {
    res.setHeader("Access-Control-Allow-Origin", this.corsAllowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, ngrok-skip-browser-warning"
    );
  }

  sendJson(res, statusCode, obj) {
    const body = JSON.stringify(obj, null, 2);
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    this.writeCorsHeaders(res);
    res.end(body);
  }

  readBody(req, cb) {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => cb(null, data));
    req.on("error", (err) => cb(err));
  }
}

// ---- Run the HTTP server and route requests to handlers
class Server2App {
  constructor(config, fixedRows) {
    this.config = config;
    this.db = new DbService(config, fixedRows);
    this.httpUtil = new HttpUtil(config.corsAllowedOrigin);

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });
  }

  start() {
    this.dbSmokeTest();

    this.server.listen(this.config.port, () => {
      console.log(`Server2 running on http://localhost:${this.config.port}`);
      console.log("POST  /lab5/api/v1/insert");
      console.log('GET   /lab5/api/v1/sql/%22select%20*%20from%20patient%22');
      console.log("GET   /lab5/api/v1/sql?query=select%20*%20from%20patient");
    });
  }

  dbSmokeTest() {
    const c = this.db.createConn(this.config.reader);
    c.connect((err) => {
      if (err) {
        console.error("DB connect failed:", err.message);
        return;
      }
      c.query("SELECT 1", (e) => {
        if (e) console.error("DB test query failed:", e.message);
        else console.log("DB connected");
        c.end();
      });
    });
  }

  handlePreflight(req, res) {
    res.statusCode = 204;
    this.httpUtil.writeCorsHeaders(res);
    res.end();
  }

  looksLikeSelectOnly(sql) {
    const trimmed = sql.trim().toUpperCase();
    return trimmed.startsWith("SELECT ");
  }

  parseSqlFromPath(pathname) {
    const encoded = pathname.slice("/lab5/api/v1/sql/".length);
    let sql = decodeURIComponent(encoded).trim();

    if (
      (sql.startsWith('"') && sql.endsWith('"')) ||
      (sql.startsWith("'") && sql.endsWith("'"))
    ) {
      sql = sql.slice(1, -1).trim();
    }

    return sql;
  }

  handleInsert(req, res) {
    this.httpUtil.readBody(req, (bodyErr) => {
      if (bodyErr) {
        return this.httpUtil.sendJson(res, 400, {
          ok: false,
          error: "Bad request body",
        });
      }

      this.db.insertFixedRows((err, result) => {
        if (err) {
          return this.httpUtil.sendJson(res, 500, {
            ok: false,
            error: "Insert failed",
            detail: err.message,
          });
        }

        return this.httpUtil.sendJson(res, 200, {
          ok: true,
          message: "Inserted fixed rows",
          insertedRows: result.affectedRows,
        });
      });
    });
  }

  handleSelectFromPath(req, res, pathname) {
    let sql = "";
    try {
      sql = this.parseSqlFromPath(pathname);
    } catch (e) {
      return this.httpUtil.sendJson(res, 400, {
        ok: false,
        error: "Bad URL encoding",
      });
    }

    if (!this.looksLikeSelectOnly(sql)) {
      return this.httpUtil.sendJson(res, 400, {
        ok: false,
        error: "Only SELECT queries are allowed.",
      });
    }

    this.db.runSelect(sql, (err, rows) => {
      if (err) {
        return this.httpUtil.sendJson(res, 400, {
          ok: false,
          error: "Query failed",
          detail: err.message,
        });
      }

      return this.httpUtil.sendJson(res, 200, { ok: true, rows });
    });
  }

  handleSelectFromQueryParam(req, res, fullUrl) {
    const sql = (fullUrl.searchParams.get("query") || "").trim();

    if (!sql) {
      return this.httpUtil.sendJson(res, 400, {
        ok: false,
        error: "Missing query param. Use /lab5/api/v1/sql?query=SELECT...",
      });
    }

    if (!this.looksLikeSelectOnly(sql)) {
      return this.httpUtil.sendJson(res, 400, {
        ok: false,
        error: "Only SELECT queries are allowed.",
      });
    }

    this.db.runSelect(sql, (err, rows) => {
      if (err) {
        return this.httpUtil.sendJson(res, 400, {
          ok: false,
          error: "Query failed",
          detail: err.message,
        });
      }

      return this.httpUtil.sendJson(res, 200, { ok: true, rows });
    });
  }

  handleRequest(req, res) {
    if (req.method === "OPTIONS") {
      return this.handlePreflight(req, res);
    }

    const fullUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = fullUrl.pathname;

    if (req.method === "POST" && pathname === "/lab5/api/v1/insert") {
      return this.handleInsert(req, res);
    }

    // ---- Prefer query-param route to reduce WAF blocking
    if (req.method === "GET" && pathname === "/lab5/api/v1/sql") {
      return this.handleSelectFromQueryParam(req, res, fullUrl);
    }

    // ---- Keep path-encoded route to match assignment format
    if (req.method === "GET" && pathname.startsWith("/lab5/api/v1/sql/")) {
      return this.handleSelectFromPath(req, res, pathname);
    }

    return this.httpUtil.sendJson(res, 404, { ok: false, error: "Not found" });
  }
}

new Server2App(CONFIG, FIXED_PATIENT_ROWS).start();
