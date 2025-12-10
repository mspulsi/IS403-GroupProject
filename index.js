
// Load environment variables from .env file
require('dotenv').config(); 

// Import necessary libraries and modules
const express=require('express');
const session=require('express-session');
const path=require('path');
const bodyParser=require('body-parser');
const knex=require('knex');
const axios=require('axios');
const pg=require('pg');

// ------------------------------------------------------------
// Create a Knex instance to connect to the PostgreSQL database
// ------------------------------------------------------------
const db=knex({
    client: 'pg',
    connection: {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT,
        ssl: process.env.DB_SSL ? {
            rejectUnauthorized: false,
        } : false,
    },
});


// Create an Express application object
const app=express();

// Set EJS as the templating engine
app.set('view engine','ejs');

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Define the port number by environment variable or default to 3000
const port= process.env.PORT || 3000;

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'defaultsecret',
    resave: false,
    saveUninitialized: false,
  })
);

// Middleware to parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));



// ------------------------------------------------------------
// Routes
// ------------------------------------------------------------

// index page is displayed at root URL
app.get('/', async (req,res)=>{
    try {
        const response = await axios.get('https://api.webz.io/newsApiLite', {
            params: {
                token: process.env.WEBZ_API_KEY,
                q:'*',
                sentiment:'positive',
            },
        });

        const news = response.data.posts || [];
        res.render('index', { news, error: null });
    } catch (error) {
        console.error('Error fetching news:', error);
        res.status(500).render('index', { error: 'Error fetching news' });
    }
});

// login page is displayed at /login URL
app.get('/login',(req,res)=>{
    res.render('login');
});

// Start the server and listen on the defined port
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});