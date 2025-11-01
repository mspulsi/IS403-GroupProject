require('dotenv').config(); // Load environment variables from .env file
const express=require('express'); // Import the Express library
const session=require('express-session'); // Import the express-session library
const path=require('path');
const bodyParser=require('body-parser');

const app=express(); // Create an Express application object

app.set('view engine','ejs'); // Set EJS as the templating engine

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

const port= process.env.PORT || 3000; // Define the port number by environment variable or default to 3000

// Middleware (app.use), to create a session for each user
app.use(
    session({
        secret: process.env.SESSION_SECRET || 'defaultsecret',
        resave: false,
        saveUninitialized: false,
    })
);

app.use(express.urlencoded({ extended: true })); // Middleware to parse URL-encoded bodies

// Login page is displayed at root URL
app.get('/',(req,res)=>{
    res.render('login');
});

// Index page is displayed at /index URL
app.get('/index',(req,res)=>{
    res.render('index');
});

// Start the server and listen on the defined port
app.listen(port,()=>{
    console.log(`Server is running at http://localhost:${port}`);
});