
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

// saved articles page (requires login)
// Route: /saved -> renders views/saved.ejs
app.get('/saved', async (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }

  try {
    // Fetch saved articles for the user from news_posts table
    const savedArticles = await db('news_posts')
      .where({ user_id: req.session.userId })
      .select('user_id', 'title', 'url');

    res.render('saved', { savedArticles });
  } catch (error) {
    console.error('Error fetching saved articles:', error);
    res.status(500).render('saved', { savedArticles: [], error: 'Error loading saved articles' });
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

// Save article to user's profile
app.post('/save-article', async (req, res) => {
  try {
    console.log('req.body:', req.body);
    console.log('req.body keys:', Object.keys(req.body));
    const { title, url } = req.body;
    console.log('Extracted title:', title);
    console.log('Extracted url:', url);
    const userId = req.session.userId;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Please log in to save articles' });
    }

    if (!title || !url) {
      return res.status(400).json({ success: false, message: 'Title and URL are required' });
    }

    // Check if article already saved for this user
    const existing = await db('news_posts')
      .where({ user_id: userId, url: url })
      .first();

    if (existing) {
      return res.status(409).json({ success: false, message: 'Article already saved' });
    }

    // Save the article to news_posts table
    await db('news_posts').insert({
      user_id: userId,
      title: title,
      url: url
    });

    res.json({ success: true, message: 'Article saved successfully' });
  } catch (error) {
    console.error('Error saving article:', error);
    res.status(500).json({ success: false, message: 'Error saving article' });
  }
});

// Remove/unsave article from user's saved articles
app.delete('/unsave-article', async (req, res) => {
  try {
    const { url } = req.body;
    const userId = req.session.userId;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Please log in to unsave articles' });
    }

    if (!url) {
      return res.status(400).json({ success: false, message: 'URL is required' });
    }

    // Delete the article from news_posts table for this user
    const deleted = await db('news_posts')
      .where({ user_id: userId, url: url })
      .del();

    if (deleted === 0) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    res.json({ success: true, message: 'Article removed successfully' });
  } catch (error) {
    console.error('Error removing article:', error);
    res.status(500).json({ success: false, message: 'Error removing article' });
  }
});

// Start the server and listen on the defined port
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});