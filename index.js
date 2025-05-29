import express from "express";
import pg from "pg";
import bcrypt, { hash } from "bcrypt";
import bodyParser from "body-parser";

const app = express();
const port = 3000;
const saltRounds = 10;

//middleware
app.use(bodyParser.urlencoded({extended:true}));
app.use(express.static("public"));

const db = new pg.Client({
    user: "postgres",
    host: "localhost",
    database: "study_scheduler",
    password: "Aditya@2311",
    port: 5432
});
db.connect();


//ROUTES
app.get("/", (req, res)=>{
    res.render("index.ejs");
});

app.get("/login", (req,res)=>{
    res.render("login.ejs");
})

app.get("/signup", (req,res)=>{
    res.render("signup.ejs");
})

//AUTHENTICATION

//REGISTER NEW USER
app.post("/register", async (req, res)=>{
    const username = req.body.username;
    const email = req.body.email;
    const password = req.body.password;

    try{

        const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [email]);
        const checkUsername = await db.query("SELECT * FROM users WHERE user_name = $1", [username]);

        if(checkResult.rows.length > 0){  //check email already present
            res.render("signup.ejs", {
                    message: "Email already exist, try logging in or use different email"
                })
            // console.log("email already exist.. try logging In");
        }else{
            if(checkUsername.rows.length > 0){  //check availability of username
                
                res.render("signup.ejs", {
                    message: "Username taken, try using different username"
                })
                // console.log("user_name already taken.. try using different user_name");
            }else{

                if(email && password && username){  //check all details are entered or not
                    
                    bcrypt.hash(password, saltRounds, async(err, hash)=>{
                        if(err){
                            console.log("Error hashing password...");
                        }else{
                            await db.query("INSERT INTO users(email, user_name, password) VALUES($1, $2, $3)", [email, username, hash]);
                            res.render("dashboard.ejs");
                        }
                    });
                    
                }else{
                    console.log("please enter all the details..");
                }

            }

        }
    }catch(err){
        console.log(err);
    }
});

//LOGIN EXISTING USER
app.post("/login", async (req,res)=>{
    const email = req.body.email;
    const loginPassword = req.body.password;

    try{
        const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    
        if(result.rows.length > 0){
            const user = result.rows[0];
            const storedHashedPassword = user.password;

            //Password Decryption and comparison
            bcrypt.compare(loginPassword, storedHashedPassword, (err, result)=>{
                if(err){
                    console.log("Error compare passwords", err);
                }else{
                    if(result){
                        res.render("dashboard.ejs");
                    }else{
                        res.render("login.ejs", {
                            message: "Incorrect Password" 
                        });
                        // res.send("Incorrect Password");
                    }
                }
            });

        }else{
            res.render("login.ejs", {
                message: "Email not found" 
            });
            // res.send("user not found");
        }

    }catch(err){
        console.log(err);
    }

});



app.listen(port, ()=>{
    console.log(`Server is running at port ${port}...`);
});