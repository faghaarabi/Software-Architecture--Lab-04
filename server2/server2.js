// server2/server2.js
// ChatGPT (https://chat.openai.com/) was used to help write and explain parts of this assignment.
// Student must understand every line and takes full responsibility.

"use strict";

const http = require("http");
const { URL } = require("url");
const mysql = require("mysql");


const CONFIG = {
  port: 3000,
  corsAllowedOrigin: "*",

  dbName: "lab5db",
  tableName: "patient",

  writer: {
    host: "localhost",
    port: 3306,
    user: "lab5_writer",
    password: "WriterPass123!",
    database: "lab5db",
  },

  reader: {
    host: "localhost",
    port: 3306,
    user: "lab5_reader",
    password: "ReaderPass123!",
    database: "lab5db",
  },
};

const FIXED_PATIENT_ROWS = [
  { name: "Alex", age: 22, city: "Vancouver" },
  { name: "Jack", age: 30, city: "Burnaby" },
  { name: "Rose", age: 28, city: "Richmond" },
];

class DbService {
  constructor(config, fixedRows) {
    this.config = config;
    this.fixedRows = fixedRows;
  }

  createConn(dbConfig) {
    return mysql.createConnection(dbConfig);
  }

  ensureDbAndTable(writerConn, cb) {
    const createDbSql = `CREATE DATABASE IF NOT EXISTS \`${this.config.dbName}\`;`;

    writerConn.query(createDbSql, (err) => {
      if (err) return cb(err);

      writerConn.query(`USE \`${this.config.dbName}\`;`, (err2) => {
        if (err2) return cb(err2);

        // ENGINE=InnoDB
      
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
    });
  }

  insertFixedRows(cb) {
    const writerConn = this.createConn(this.config.writer);

    writerConn.connect((err) => {
      if (err) {
        return cb(err);
      }

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

      readerConn.query(sql, (qErr, rows) => {
        readerConn.end();
        if (qErr) return cb(qErr);
        return cb(null, rows);
      });
    });
  }
}

class HttpUtil {
  constructor(corsAllowedOrigin) {
    this.corsAllowedOrigin = corsAllowedOrigin;
  }

  writeCorsHeaders(res) {
    res.setHeader("Access-Control-Allow-Origin", this.corsAllowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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


class Server2App {
  constructor(config, fixedRows) {
    this.config = config;
    this.db = new DbService(config, fixedRows);
    this.httpUtil = new HttpUtil(config.corsAllowedOrigin);

    this.server = http.createServer((req,res) => {
      this.handleRequest(req, res);
    });
  }

  start() {
    this.server.listen(this.config.port, () => {
      console.log(`Server2 running on http://localhost:${this.config.port}`);
      console.log("POST  /lab5/api/v1/insert");
      console.log('GET   /lab5/api/v1/sql/%22select%20*%20from%20patient%22');
    });
  }

  handlePreflight(req, res) {
    res.statusCode = 204; // for OPTIONS 204 means success
    this.httpUtil.writeCorsHeaders(res);
    res.end();
  }

  looksLikeSelectOnly(sql) {
    // Optional extra safety check (REAL protection is DB privileges)
    const trimmed = sql.trim().toUpperCase();
    return trimmed.startsWith("SELECT ");
  }

  parseSqlFromPath(pathname) {
    // pathname: /lab5/api/v1/sql/<encoded>
    const encoded = pathname.slice("/lab5/api/v1/sql/".length);

    let sql = decodeURIComponent(encoded).trim();

    // allow SQL wrapped in quotes: "select ..." or 'select ...'
    if (
      (sql.startsWith('"') && sql.endsWith('"')) ||
      (sql.startsWith("'") && sql.endsWith("'"))
    ) {
      sql = sql.slice(1, -1).trim();
    }

    return sql;
  }

  handleInsert(req, res) {
    // We read body (even if unused) to be safe with POST
    this.httpUtil.readBody(req, (bodyErr) => {
      if (bodyErr) {
        return this.httpUtil.sendJson(res, 400, { ok: false, error: "Bad request body" });
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

  handleSelect(req, res, pathname) {
    let sql = "";
    try {
      sql = this.parseSqlFromPath(pathname);
    } catch (e) {
      return this.httpUtil.sendJson(res, 400, { ok: false, error: "Bad URL encoding" });
    }

    if (!this.looksLikeSelectOnly(sql)) {
      return this.httpUtil.sendJson(res, 400, { ok: false, error: "Only SELECT queries are allowed." });
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
    // CORS preflight
    if (req.method === "OPTIONS") {
      return this.handlePreflight(req, res);
    }

    const fullUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = fullUrl.pathname;

    
    if (req.method === "POST" && pathname === "/lab5/api/v1/insert") {
      return this.handleInsert(req, res);
    }

    // GET /lab5/api/v1/sql/<encoded SQL>
    if (req.method === "GET" && pathname.startsWith("/lab5/api/v1/sql/")) {
      return this.handleSelect(req, res, pathname);
    }

    return this.httpUtil.sendJson(res, 404, { ok: false, error: "Not found" });
  }
}

// -------------------- RUN --------------------
new Server2App(CONFIG, FIXED_PATIENT_ROWS).start();
