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
    user: "postgres.iczhyonqbgjfvmxdigyz",
    host: "aws-0-ap-south-1.pooler.supabase.com",
    database: "postgres",
    password: "Aditya@2311#",
    port: 5432
});
db.connect();

// Session store setup
const PostgresqlStore = pgSession(session);
const sessionStore = new PostgresqlStore({
    pool: session,
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

// SM2 Algorithm Implementation
const calculateNextReview = (quality, repetitions, easiness, interval) => {
    // Quality: 0-5 rating from user
    // Repetitions: number of times reviewed
    // Easiness: E-Factor, starts at 2.5
    // Interval: days between reviews

    if (quality < 3) {
        repetitions = 0;
        interval = 1;
    } else {
        repetitions += 1;
        if (repetitions === 1) {
            interval = 1;
        } else if (repetitions === 2) {
            interval = 6;
        } else {
            interval = Math.round(interval * easiness);
        }
    }

    // Update easiness factor
    easiness = Math.max(1.3, easiness + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));

    return {
        nextInterval: interval,
        newRepetitions: repetitions,
        newEasiness: easiness
    };
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
        // Get topics due today
        const todayTopics = await db.query(
            `SELECT * FROM topics 
             WHERE user_id = $1 
             AND next_revision_date = CURRENT_DATE
             ORDER BY subject_name`,
            [req.session.userId]
        );

        // Get upcoming topics (next 7 days)
        const upcomingTopics = await db.query(
            `SELECT * FROM topics 
             WHERE user_id = $1 
             AND next_revision_date > CURRENT_DATE 
             AND next_revision_date <= CURRENT_DATE + INTERVAL '7 days'
             ORDER BY next_revision_date, subject_name`,
            [req.session.userId]
        );

        // Get progress statistics
        const totalTopics = await db.query(
            "SELECT COUNT(*) FROM topics WHERE user_id = $1",
            [req.session.userId]
        );

        const revisionsThisWeek = await db.query(
            `SELECT COUNT(*) FROM revisions r
             JOIN topics t ON r.topic_id = t.id
             WHERE t.user_id = $1
             AND r.revision_date >= CURRENT_DATE - INTERVAL '7 days'`,
            [req.session.userId]
        );

        res.render("dashboard.ejs", {
            user: req.session.user,
            todayTopics: todayTopics.rows,
            upcomingTopics: upcomingTopics.rows,
            stats: {
                total: totalTopics.rows[0].count,
                dueToday: todayTopics.rows.length,
                weeklyRevisions: revisionsThisWeek.rows[0].count
            }
        });
    } catch (err) {
        console.error("Dashboard error:", err);
        res.status(500).render("error.ejs", { message: "Failed to load dashboard" });
    }
});

app.get("/review/:topicId", requireLogin, async (req, res) => {
    try {
        const topic = await db.query(
            "SELECT * FROM topics WHERE id = $1 AND user_id = $2",
            [req.params.topicId, req.session.userId]
        );

        if (topic.rows.length === 0) {
            return res.status(404).render("error.ejs", { message: "Topic not found" });
        }

        res.render("review.ejs", { topic: topic.rows[0] });
    } catch (err) {
        console.error("Review error:", err);
        res.status(500).render("error.ejs", { message: "Failed to load review page" });
    }
});

app.post("/review/:topicId", requireLogin, async (req, res) => {
    const { quality } = req.body;
    const topicId = req.params.topicId;

    try {
        // Get current topic data
        const topic = await db.query(
            "SELECT * FROM topics WHERE id = $1 AND user_id = $2",
            [topicId, req.session.userId]
        );

        if (topic.rows.length === 0) {
            return res.status(404).json({ error: "Topic not found" });
        }

        const currentTopic = topic.rows[0];

        // Calculate next review using SM2
        const {
            nextInterval,
            newRepetitions,
            newEasiness
        } = calculateNextReview(
            parseInt(quality),
            currentTopic.repetitions || 0,
            currentTopic.easiness || 2.5,
            currentTopic.current_interval
        );

        await db.query(
            `UPDATE topics 
             SET next_revision_date = CURRENT_DATE + make_interval(days => $1::int),
                 current_interval = $1,
                 repetitions = $2,
                 easiness = $3
             WHERE id = $4`,
            [nextInterval, newRepetitions, newEasiness, topicId]
        );

        // Record the revision
        await db.query(
            `INSERT INTO revisions (topic_id, revision_date, retention_rating)
             VALUES ($1, CURRENT_DATE, $2)`,
            [topicId, parseInt(quality)]
        );

        res.redirect('/dashboard');
    } catch (err) {
        console.error("Review submission error:", err);
        res.status(500).json({ error: "Failed to update review" });
    }
});

// Profile routes
app.get("/profile", requireLogin, (req, res) => {
    res.render("profile.ejs", { user: req.session.user });
});

app.post("/change-password", requireLogin, async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    try {
        const result = await db.query(
            "SELECT password FROM users WHERE id = $1",
            [req.session.userId]
        );

        const match = await bcrypt.compare(currentPassword, result.rows[0].password);
        if (!match) {
            return res.render("profile.ejs", {
                user: req.session.user,
                error: "Current password is incorrect"
            });
        }

        const hash = await bcrypt.hash(newPassword, saltRounds);
        await db.query(
            "UPDATE users SET password = $1 WHERE id = $2",
            [hash, req.session.userId]
        );

        res.render("profile.ejs", {
            user: req.session.user,
            success: "Password updated successfully"
        });
    } catch (err) {
        console.error("Password change error:", err);
        res.render("profile.ejs", {
            user: req.session.user,
            error: "Failed to update password"
        });
    }
});

app.post("/delete-account", requireLogin, async (req, res) => {
    try {
        await db.query("DELETE FROM users WHERE id = $1", [req.session.userId]);
        req.session.destroy();
        res.redirect('/');
    } catch (err) {
        console.error("Account deletion error:", err);
        res.render("profile.ejs", {
            user: req.session.user,
            error: "Failed to delete account"
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

// Create sessions table
const createSessionTable = async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS "user_sessions" (
                "sid" varchar NOT NULL COLLATE "default",
                "sess" json NOT NULL,
                "expire" timestamp(6) NOT NULL,
                CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
            )
        `);
    } catch (err) {
        console.error('Error creating session table:', err);
    }
};

createSessionTable();

app.listen(port, () => {
    console.log(`Server is running at port ${port}...`);
});
