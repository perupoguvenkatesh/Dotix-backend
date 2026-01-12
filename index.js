// server.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./db');
const axios = require('axios');
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Use local webhook test endpoint for development
const WEBHOOK_URL = "http://localhost:3001/webhook-test";

/**
POST /jobs
Create a job with status "pending"
**/
app.post('/jobs', (req, res) => {
  const { taskName, payload, priority } = req.body;

  if (!taskName || !priority) {
    return res.status(400).json({ error: 'taskName and priority are required' });
  }
  let parsedPayload = {};
  try {
    parsedPayload = typeof payload === 'string' ? JSON.parse(payload) : payload || {};
  } catch {
    return res.status(400).json({ error: 'payload must be valid JSON' });
  }

  const createdAt = new Date().toISOString();
  const updatedAt = createdAt;
  const status = "pending";

  db.run(
    `INSERT INTO jobs (taskName, payload, priority, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [taskName, JSON.stringify(parsedPayload), priority, status, createdAt, updatedAt],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      db.get(`SELECT * FROM jobs WHERE id = ?`, [this.lastID], (err2, row) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json(row);
      });
    }
  );
});

/**
 * GET /jobs
 * List jobs with optional filters: status, priority
 */
app.get('/jobs', (req, res) => {
  const { status, priority } = req.query;
  const clauses = [];
  const params = [];

  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  if (priority) {
    clauses.push('priority = ?');
    params.push(priority);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  db.all(`SELECT * FROM jobs ${where} ORDER BY createdAt DESC`, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

/**
 * GET /jobs/:id
 * Job detail
 */
app.get('/jobs/:id', (req, res) => {
  db.get(`SELECT * FROM jobs WHERE id = ?`, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Job not found' });
    res.json(row);
  });
});

/**
 * POST /run-job/:id
 * Simulates processing: running -> wait -> completed, then triggers webhook
 */
app.post('/run-job/:id', (req, res) => {
  const id = req.params.id;
  const now = new Date().toISOString();

  db.run(`UPDATE jobs SET status = ?, updatedAt = ? WHERE id = ?`, ["running", now, id], (err) => {
    if (err) return res.status(500).json({ error: err.message });

    // Respond immediately so UI doesn’t block
    res.json({ message: "Job is running", jobId: id });

    setTimeout(() => {
      const completedAt = new Date().toISOString();

      db.get(`SELECT * FROM jobs WHERE id = ?`, [id], (err, job) => {
        if (err || !job) {
          console.error("Job fetch error:", err?.message || "not found");
          return;
        }

        db.run(`UPDATE jobs SET status = ?, updatedAt = ? WHERE id = ?`, ["completed", completedAt, id], (err2) => {
          if (err2) {
            console.error("Job complete update error:", err2.message);
            return;
          }

          // Webhook payload
          const payload = {
            jobId: job.id,
            taskName: job.taskName,
            priority: job.priority,
            payload: (() => { try { return JSON.parse(job.payload); } catch { return job.payload; } })(),
            completedAt
          };

          axios.post(WEBHOOK_URL, payload)
            .then((response) => {
              console.log("Webhook sent:", response.status);
            })
            .catch((error) => {
              console.error("Webhook error:", error.message);
            });
        });
      });
    }, 3000);
  });
});

/**
 * POST /webhook-test (optional)
 * Local receiver you can point WEBHOOK_URL to while developing
 */
app.post('/webhook-test', (req, res) => {
  console.log("Received webhook:", req.body);
  res.json({ received: true, at: new Date().toISOString() });
});

app.listen(3001, () => {
  console.log("Server running on http://localhost:3001");
});