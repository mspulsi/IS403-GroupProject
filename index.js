require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

const port = process.env.PORT || 3000;

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'defaultsecret',
    resave: false,
    saveUninitialized: false,
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Simple flash helper stored in the session
const setFlash = (req, payload = {}) => {
  req.session.flash = { ...(req.session.flash || {}), ...payload };
};

const getFlash = (req) => {
  const flash = req.session.flash || {};
  delete req.session.flash;
  return flash;
};

// Expose logged-in user to templates
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    setFlash(req, { error: 'Please log in to access preferences.' });
    return res.redirect('/login');
  }
  next();
};

// Public landing page
app.get('/', (req, res) => {
  res.render('index', { username: req.session.username || null });
});

// Alias to home if needed
app.get('/index', (req, res) => res.redirect('/'));

// Login page
app.get('/login', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }
  const flash = getFlash(req);
  res.render('login', { error: flash.error, success: flash.success });
});

// Sign-up page
app.get('/signup', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }
  const flash = getFlash(req);
  res.render('signup', { error: flash.error, success: flash.success });
});

// Handle login
app.post('/login', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  if (!username || !password) {
    setFlash(req, { error: 'Please provide both username and password.' });
    return res.redirect('/login');
  }

  try {
    const user = await db('users')
      .whereRaw('LOWER(username) = LOWER(?)', [username])
      .first();

    if (!user) {
      setFlash(req, { error: 'Invalid username or password.' });
      return res.redirect('/login');
    }

    const isValid = await bcrypt.compare(password, user.password || '');
    if (!isValid) {
      setFlash(req, { error: 'Invalid username or password.' });
      return res.redirect('/login');
    }

    req.session.userId = user.user_id || user.id;
    req.session.username = user.username;
    req.session.user = { id: req.session.userId, username: user.username };

    res.redirect('/');
  } catch (err) {
    console.error('Login error:', err);
    setFlash(req, { error: 'Something went wrong while logging in.' });
    res.redirect('/login');
  }
});

// Handle sign-up
app.post('/signup', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const confirmPassword = req.body.confirmPassword || '';

  if (!username || !password) {
    setFlash(req, { error: 'Username and password are required.' });
    return res.redirect('/signup');
  }

  if (password !== confirmPassword) {
    setFlash(req, { error: 'Passwords do not match.' });
    return res.redirect('/signup');
  }

  if (password.length < 6) {
    setFlash(req, { error: 'Password must be at least 6 characters long.' });
    return res.redirect('/signup');
  }

  try {
    const existing = await db('users')
      .whereRaw('LOWER(username) = LOWER(?)', [username])
      .first();

    if (existing) {
      setFlash(req, { error: 'That username is already taken.' });
      return res.redirect('/signup');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const inserted = await db('users')
      .insert({ username, password: hashedPassword })
      .returning(['user_id', 'username']);

    const createdUser = Array.isArray(inserted) ? inserted[0] : inserted;
    const userId = createdUser?.user_id || createdUser?.id || createdUser;

    req.session.userId = userId;
    req.session.username = createdUser?.username || username;
    req.session.user = { id: userId, username: req.session.username };

    res.redirect('/');
  } catch (err) {
    console.error('Signup error:', err);
    setFlash(req, { error: 'Unable to create account. Please try again.' });
    res.redirect('/signup');
  }
});

// Preferences page (requires login)
app.get('/preferences', requireAuth, (req, res) => {
  res.render('preferences', { username: req.session.username });
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// Start the server and listen on the defined port
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});