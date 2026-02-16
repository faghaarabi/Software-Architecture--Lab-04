

const mysql = require("mysql");


const db = mysql.createConnection({
  host: "127.0.0.1",
  port: 3306,          // XAMPP MySQL/MariaDB default
  user: "root",        // XAMPP default
  password: "",        // XAMPP default (often empty)
  database: "WebDev",   // <-- change to your database name
});

db.connect((err) => {
  if (err) {
    console.error("DB connect failed:", err.message);
    process.exit(1);
  }
  console.log("Connected to DB");

  const createSql = `
    CREATE TABLE IF NOT EXISTS score (
      scoreID INT NOT NULL AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      score INT NOT NULL,
      PRIMARY KEY (scoreID)
    );
  `;

  db.query(createSql, (err) => {
    if (err) {
      console.error("CREATE TABLE failed:", err.message);
      db.end();
      return;
    }
    console.log("Table ready");

    const insertSql = "INSERT INTO score (name, score) VALUES (?, ?)";
    db.query(insertSql, ["Fereshteh", 100], (err, result) => {
      if (err) {
        console.error("INSERT failed:", err.message);
        db.end();
        return;
      }
      console.log("Inserted row id:", result.insertId);

      const selectSql = "SELECT scoreID, name, score FROM score ORDER BY scoreID DESC";
      db.query(selectSql, (err, rows) => {
        if (err) {
          console.error("SELECT failed:", err.message);
          db.end();
          return;
        }

        console.log("Scores:");
        console.table(rows);

        db.end(() => console.log("Connection closed"));
      });
    });
  });
});
