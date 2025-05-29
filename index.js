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

app.get("/dashboard", requireLogin, (req, res) => {
    res.render("dashboard.ejs", { user: req.session.user });
});

app.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.log("Error destroying session:", err);
        }
        res.redirect('/');
    });
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