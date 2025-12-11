
// Load environment variables from .env file
require('dotenv').config(); 

// Import necessary libraries and modules
const express = require('express');
const session = require('express-session');
const path = require('path');
const knex = require('knex');
const axios = require('axios');
const pg = require('pg');
const bcrypt = require('bcryptjs');

// ------------------------------------------------------------
// Create a Knex instance to connect to the PostgreSQL database
// ------------------------------------------------------------
const db = knex({
  client: 'pg',
  connection: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: process.env.DB_SSL
      ? {
          rejectUnauthorized: false,
        }
      : false,
  },
});


// Create an Express application object
const app = express();

// Set EJS as the templating engine
app.set('view engine', 'ejs');

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Define the port number by environment variable or default to 3000
const port= process.env.PORT || 3000;

// Middleware (app.use), to create a session for each user
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'defaultsecret',
    resave: false,
    saveUninitialized: false,
  })
);

// Middleware to parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));
// Make session data available to templates
app.use((req, res, next) => {
  res.locals.username = req.session.username || null;
  next();
});

// ------------------------------------------------------------
// Routes
// ------------------------------------------------------------

// index page is displayed at root URL
app.get('/', async (req, res) => {
  try {
    const response = await axios.get('https://api.webz.io/newsApiLite', {
      params: {
        token: process.env.WEBZ_API_KEY,
        q: '*',
        sentiment: 'positive',
      },
    });

    const news = response.data.posts || [];
    res.render('index', { news, error: null });
  } catch (error) {
    console.error('Error fetching news:', error);
    res.status(500).render('index', { error: 'Error fetching news' });
  }
});

// preferences page (requires login)
app.get('/preferences', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  res.render('preferences');
});

// login page is displayed at /login URL
app.get('/login', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }
  res.render('login', { error: null, values: { username: '' } });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).render('login', {
      error: 'Please provide both username and password.',
      values: { username: username || '' },
    });
  }

  try {
    const user = await db('users').where({ username }).first();
    if (!user) {
      return res.status(401).render('login', {
        error: 'Invalid username or password.',
        values: { username },
      });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).render('login', {
        error: 'Invalid username or password.',
        values: { username },
      });
    }

    req.session.userId = user.user_id;
    req.session.username = user.username;
    return res.redirect('/');
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).render('login', {
      error: 'Something went wrong. Please try again.',
      values: { username },
    });
  }
});

app.get('/signup', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }
  res.render('signup', {
    error: null,
    values: {
      username: '',
      first_name: '',
      last_name: '',
      city: '',
      state: '',
      country: '',
    },
  });
});

app.post('/signup', async (req, res) => {
  const {
    username,
    password,
    confirm_password,
    first_name,
    last_name,
    city,
    state,
    country,
  } = req.body;

  const renderWithError = (message) =>
    res.status(400).render('signup', {
      error: message,
      values: {
        username: username || '',
        first_name: first_name || '',
        last_name: last_name || '',
        city: city || '',
        state: state || '',
        country: country || '',
      },
    });

  if (!username || !password) {
    return renderWithError('Username and password are required.');
  }

  if (password !== confirm_password) {
    return renderWithError('Passwords do not match.');
  }

  if (password.length < 8) {
    return renderWithError('Password must be at least 8 characters.');
  }

  try {
    const user = await db.transaction(async (trx) => {
      const existingUser = await trx('users').where({ username }).first();
      if (existingUser) {
        throw new Error('DUPLICATE_USER');
      }

      const normalizedState = state ? state.trim() : null;
      const normalizedCountry = country ? country.trim() : null;

      const passwordHash = await bcrypt.hash(password, 10);
      const [newUser] = await trx('users')
        .insert({
          username,
          password: passwordHash,
        })
        .returning(['user_id', 'username']);

      await trx('person').insert({
        user_id: newUser.user_id,
        first_name: first_name || null,
        last_name: last_name || null,
        city: city || null,
        state: normalizedState,
        country: normalizedCountry,
      });

      return newUser;
    });

    req.session.userId = user.user_id;
    req.session.username = user.username;

    return res.redirect('/');
  } catch (error) {
    if (error.message === 'DUPLICATE_USER') {
      return res.status(409).render('signup', {
        error: 'An account with that username already exists.',
        values: {
          username,
          first_name: first_name || '',
          last_name: last_name || '',
          city: city || '',
          state: state || '',
          country: country || '',
        },
      });
    }

    console.error('Signup error:', error);
    return res.status(500).render('signup', {
      error: 'Something went wrong. Please try again.',
      values: {
        username,
        first_name: first_name || '',
        last_name: last_name || '',
        city: city || '',
        state: state || '',
        country: country || '',
      },
    });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Start the server and listen on the defined port
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});