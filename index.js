import express from "express";
import pg from "pg";
import bcrypt from "bcrypt";
import bodyParser from "body-parser";
import session from "express-session";
import pgSession from "connect-pg-simple";

const app = express();
const port = 3000;
const saltRounds = 10;

// Database configuration
const db = new pg.Client({
    user: "postgres",
    host: "localhost",
    database: "study_scheduler",
    password: "Aditya@2311",
    port: 5432
});
db.connect();

// Session store setup
const PostgresqlStore = pgSession(session);
const sessionStore = new PostgresqlStore({
    pool: db,
    tableName: 'user_sessions'
});

// Middleware
app.use(bodyParser.urlencoded({extended: true}));
app.use(express.static("public"));
app.use(session({
    store: sessionStore,
    secret: 'your-secret-key-here',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }
}));

// Authentication middleware
const requireLogin = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
};

// Calculate next revision date based on current interval
const calculateNextRevisionDate = (currentInterval) => {
    const today = new Date();
    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + currentInterval);
    return nextDate;
};

// Calculate new interval based on retention rating
const calculateNewInterval = (currentInterval, retentionRating) => {
    // If retention is poor (1-2), decrease interval
    if (retentionRating <= 2) {
        return Math.max(1, Math.floor(currentInterval * 0.5));
    }
    // If retention is perfect (5), increase interval significantly
    else if (retentionRating === 5) {
        return Math.floor(currentInterval * 2.5);
    }
    // If retention is good (3-4), increase interval moderately
    else {
        return Math.floor(currentInterval * 1.5);
    }
};

// ROUTES
app.get("/", (req, res) => {
    res.render("index.ejs", { user: req.session.user });
});

app.get("/login", (req, res) => {
    if (req.session.userId) {
        res.redirect('/dashboard');
    } else {
        res.render("login.ejs");
    }
});

app.get("/signup", (req, res) => {
    if (req.session.userId) {
        res.redirect('/dashboard');
    } else {
        res.render("signup.ejs");
    }
});

app.get("/dashboard", requireLogin, async (req, res) => {
    try {
        // Get topics due for revision today
        const dueTopics = await db.query(
            `SELECT * FROM topics 
             WHERE user_id = $1 
             AND next_revision_date <= CURRENT_DATE
             ORDER BY next_revision_date ASC`,
            [req.session.userId]
        );

        // Get all topics for the user
        const allTopics = await db.query(
            `SELECT * FROM topics 
             WHERE user_id = $1 
             ORDER BY next_revision_date ASC`,
            [req.session.userId]
        );

        res.render("dashboard.ejs", {
            user: req.session.user,
            dueTopics: dueTopics.rows,
            allTopics: allTopics.rows
        });
    } catch (err) {
        console.error(err);
        res.render("dashboard.ejs", {
            user: req.session.user,
            error: "Failed to load topics"
        });
    }
});

app.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.log("Error destroying session:", err);
        }
        res.redirect('/');
    });
});

// Add new topic
app.post("/topics/add", requireLogin, async (req, res) => {
    const { subject_name, topic_name, initial_study_date } = req.body;
    
    try {
        const result = await db.query(
            `INSERT INTO topics 
             (user_id, subject_name, topic_name, initial_study_date, next_revision_date, current_interval) 
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [req.session.userId, subject_name, topic_name, initial_study_date, initial_study_date, 1]
        );
        
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.redirect('/dashboard?error=Failed to add topic');
    }
});

// Complete revision
app.post("/topics/revise", requireLogin, async (req, res) => {
    const { topic_id, retention_rating } = req.body;
    
    try {
        // Get current topic data
        const topicResult = await db.query(
            "SELECT * FROM topics WHERE id = $1 AND user_id = $2",
            [topic_id, req.session.userId]
        );
        
        if (topicResult.rows.length === 0) {
            return res.status(404).json({ error: "Topic not found" });
        }
        
        const topic = topicResult.rows[0];
        const newInterval = calculateNewInterval(topic.current_interval, parseInt(retention_rating));
        const nextRevisionDate = calculateNextRevisionDate(newInterval);
        
        // Begin transaction
        await db.query('BEGIN');
        
        // Record the revision
        await db.query(
            `INSERT INTO revisions (topic_id, revision_date, retention_rating)
             VALUES ($1, CURRENT_DATE, $2)`,
            [topic_id, retention_rating]
        );
        
        // Update topic with new interval and next revision date
        await db.query(
            `UPDATE topics 
             SET current_interval = $1, next_revision_date = $2
             WHERE id = $3`,
            [newInterval, nextRevisionDate, topic_id]
        );
        
        await db.query('COMMIT');
        res.redirect('/dashboard');
    } catch (err) {
        await db.query('ROLLBACK');
        console.error(err);
        res.redirect('/dashboard?error=Failed to record revision');
    }
});

// AUTHENTICATION

// REGISTER NEW USER
app.post("/register", async (req, res) => {
    const username = req.body.username;
    const email = req.body.email;
    const password = req.body.password;

    try {
        const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [email]);
        const checkUsername = await db.query("SELECT * FROM users WHERE user_name = $1", [username]);

        if (checkResult.rows.length > 0) {
            res.render("signup.ejs", {
                message: "Email already exist, try logging in or use different email"
            });
        } else if (checkUsername.rows.length > 0) {
            res.render("signup.ejs", {
                message: "Username taken, try using different username"
            });
        } else if (email && password && username) {
            const hash = await bcrypt.hash(password, saltRounds);
            const result = await db.query(
                "INSERT INTO users(email, user_name, password) VALUES($1, $2, $3) RETURNING id, user_name",
                [email, username, hash]
            );
            
            const user = result.rows[0];
            req.session.userId = user.id;
            req.session.user = { username: user.user_name };
            res.redirect('/dashboard');
        } else {
            res.render("signup.ejs", {
                message: "Please enter all the details"
            });
        }
    } catch (err) {
        console.log(err);
        res.render("signup.ejs", {
            message: "An error occurred during registration"
        });
    }
});

// LOGIN EXISTING USER
app.post("/login", async (req, res) => {
    const email = req.body.email;
    const loginPassword = req.body.password;

    try {
        const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    
        if (result.rows.length > 0) {
            const user = result.rows[0];
            const match = await bcrypt.compare(loginPassword, user.password);
            
            if (match) {
                req.session.userId = user.id;
                req.session.user = { username: user.user_name };
                res.redirect('/dashboard');
            } else {
                res.render("login.ejs", {
                    message: "Incorrect Password"
                });
            }
        } else {
            res.render("login.ejs", {
                message: "Email not found"
            });
        }
    } catch (err) {
        console.log(err);
        res.render("login.ejs", {
            message: "An error occurred during login"
        });
    }
});

// Create necessary tables
const createTables = async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS "user_sessions" (
                "sid" varchar NOT NULL COLLATE "default",
                "sess" json NOT NULL,
                "expire" timestamp(6) NOT NULL,
                CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
            )
        `);
        
        await db.query(`
            CREATE TABLE IF NOT EXISTS topics (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                subject_name VARCHAR(100) NOT NULL,
                topic_name VARCHAR(255) NOT NULL,
                initial_study_date DATE NOT NULL,
                next_revision_date DATE NOT NULL,
                current_interval INTEGER NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await db.query(`
            CREATE TABLE IF NOT EXISTS revisions (
                id SERIAL PRIMARY KEY,
                topic_id INTEGER REFERENCES topics(id),
                revision_date DATE NOT NULL,
                retention_rating INTEGER CHECK (retention_rating BETWEEN 1 AND 5),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
    } catch (err) {
        console.error('Error creating tables:', err);
    }
};

createTables();

app.listen(port, () => {
    console.log(`Server is running at port ${port}...`);
});