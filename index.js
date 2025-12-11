
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
  res.locals.isAdmin = req.session.isAdmin || false;
  next();
});

// Auth helpers
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
};

const requireAdmin = async (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  try {
    // trust session flag if set, but verify against DB to avoid stale sessions
    if (req.session.isAdmin) {
      return next();
    }
    const user = await db('users')
      .select('is_admin')
      .where({ user_id: req.session.userId })
      .first();
    if (user && user.is_admin) {
      req.session.isAdmin = true;
      res.locals.isAdmin = true;
      return next();
    }
    return res.status(403).send('Forbidden');
  } catch (err) {
    console.error('Admin check error:', err);
    return res.status(500).send('Server error');
  }
};

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
    req.session.isAdmin = !!user.is_admin;
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
        .returning(['user_id', 'username', 'is_admin']);

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
    req.session.isAdmin = !!user.is_admin;

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

// ------------------------------------------------------------
// Admin: manage users/person records (CRUD + search)
// ------------------------------------------------------------
app.get('/admin/users', requireAdmin, async (req, res) => {
  const { search } = req.query;
  try {
    const searchTerm = search ? search.trim() : '';
    const searchId = searchTerm && !Number.isNaN(Number(searchTerm)) ? Number(searchTerm) : null;

    let query = db('person')
      .leftJoin('users', 'person.user_id', 'users.user_id')
      .select(
        'person.person_id',
        'person.user_id',
        'person.first_name',
        'person.last_name',
        'person.city',
        'person.state',
        'person.country',
        'person.preference_one',
        'person.preference_two',
        'person.preference_three',
        'users.username'
      );

    if (searchTerm) {
      query = query.where((qb) => {
        qb.whereILike('users.username', `%${searchTerm}%`)
          .orWhereILike('person.first_name', `%${searchTerm}%`)
          .orWhereILike('person.last_name', `%${searchTerm}%`)
          .orWhereILike('person.city', `%${searchTerm}%`)
          .orWhereILike('person.state', `%${searchTerm}%`)
          .orWhereILike('person.country', `%${searchTerm}%`);
        if (searchId !== null) {
          qb.orWhere('person.user_id', searchId);
        }
      });
    }

    const people = await query.orderBy('person.person_id', 'asc');
    res.render('admin-users', {
      people,
      search: search || '',
      error: null,
      message: null,
    });
  } catch (error) {
    console.error('Admin list error:', error);
    res.status(500).render('admin-users', {
      people: [],
      search: search || '',
      error: 'Unable to load users.',
      message: null,
    });
  }
});

app.get('/admin/users/new', requireAdmin, (req, res) => {
  res.render('admin-user-form', {
    mode: 'create',
    error: null,
    values: {
      username: '',
      first_name: '',
      last_name: '',
      city: '',
      state: '',
      country: '',
      preference_one: '',
      preference_two: '',
      preference_three: '',
    },
  });
});

app.post('/admin/users', requireAdmin, async (req, res) => {
  const {
    username,
    password,
    confirm_password,
    first_name,
    last_name,
    city,
    state,
    country,
    preference_one,
    preference_two,
    preference_three,
  } = req.body;

  const renderWithError = (message) =>
    res.status(400).render('admin-user-form', {
      mode: 'create',
      error: message,
      values: {
        username: username || '',
        first_name: first_name || '',
        last_name: last_name || '',
        city: city || '',
        state: state || '',
        country: country || '',
        preference_one: preference_one || '',
        preference_two: preference_two || '',
        preference_three: preference_three || '',
      },
    });

  if (!username || !password) {
    return renderWithError('Username and password are required.');
  }
  if (password.length < 8) {
    return renderWithError('Password must be at least 8 characters.');
  }
  if (password !== confirm_password) {
    return renderWithError('Passwords do not match.');
  }

  try {
    await db.transaction(async (trx) => {
      const existing = await trx('users').where({ username }).first();
      if (existing) {
        throw new Error('DUPLICATE_USER');
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const [newUser] = await trx('users')
        .insert({
          username,
          password: passwordHash,
        })
        .returning(['user_id']);

      await trx('person').insert({
        user_id: newUser.user_id,
        first_name: first_name || null,
        last_name: last_name || null,
        city: city || null,
        state: state || null,
        country: country || null,
        preference_one: preference_one || null,
        preference_two: preference_two || null,
        preference_three: preference_three || null,
      });
    });

    return res.redirect('/admin/users');
  } catch (error) {
    if (error.message === 'DUPLICATE_USER') {
      return renderWithError('That username is already taken.');
    }
    console.error('Admin create error:', error);
    return renderWithError('Something went wrong. Please try again.');
  }
});

app.get('/admin/users/:id/edit', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const person = await db('person')
      .leftJoin('users', 'person.user_id', 'users.user_id')
      .select(
        'person.person_id',
        'person.user_id',
        'person.first_name',
        'person.last_name',
        'person.city',
        'person.state',
        'person.country',
        'person.preference_one',
        'person.preference_two',
        'person.preference_three',
        'users.username'
      )
      .where('person.person_id', id)
      .first();

    if (!person) {
      return res.redirect('/admin/users');
    }

    res.render('admin-user-form', {
      mode: 'edit',
      error: null,
      values: person,
    });
  } catch (error) {
    console.error('Admin edit load error:', error);
    res.redirect('/admin/users');
  }
});

app.post('/admin/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const {
    username,
    password,
    confirm_password,
    first_name,
    last_name,
    city,
    state,
    country,
    preference_one,
    preference_two,
    preference_three,
  } = req.body;

  const renderWithError = (message, valuesOverride = {}) =>
    res.status(400).render('admin-user-form', {
      mode: 'edit',
      error: message,
      values: {
        person_id: id,
        username: username || '',
        first_name: first_name || '',
        last_name: last_name || '',
        city: city || '',
        state: state || '',
        country: country || '',
        preference_one: preference_one || '',
        preference_two: preference_two || '',
        preference_three: preference_three || '',
        ...valuesOverride,
      },
    });

  if (!username) {
    return renderWithError('Username is required.');
  }
  if (password && password.length < 8) {
    return renderWithError('Password must be at least 8 characters.');
  }
  if (password && password !== confirm_password) {
    return renderWithError('Passwords do not match.');
  }

  try {
    await db.transaction(async (trx) => {
      const existing = await trx('person')
        .leftJoin('users', 'person.user_id', 'users.user_id')
        .select('users.user_id')
        .where('person.person_id', id)
        .first();

      if (!existing) {
        throw new Error('NOT_FOUND');
      }

      // ensure username unique
      const duplicate = await trx('users')
        .where({ username })
        .whereNot({ user_id: existing.user_id })
        .first();
      if (duplicate) {
        throw new Error('DUPLICATE_USER');
      }

      const userUpdate = { username };
      if (password) {
        userUpdate.password = await bcrypt.hash(password, 10);
      }

      await trx('users').where({ user_id: existing.user_id }).update(userUpdate);

      await trx('person')
        .where({ person_id: id })
        .update({
          first_name: first_name || null,
          last_name: last_name || null,
          city: city || null,
          state: state || null,
          country: country || null,
          preference_one: preference_one || null,
          preference_two: preference_two || null,
          preference_three: preference_three || null,
        });
    });

    return res.redirect('/admin/users');
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      return res.redirect('/admin/users');
    }
    if (error.message === 'DUPLICATE_USER') {
      return renderWithError('That username is already taken.');
    }
    console.error('Admin update error:', error);
    return renderWithError('Something went wrong. Please try again.');
  }
});

app.post('/admin/users/:id/delete', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await db.transaction(async (trx) => {
      const existing = await trx('person')
        .select('user_id')
        .where({ person_id: id })
        .first();
      if (!existing) {
        throw new Error('NOT_FOUND');
      }
      await trx('person').where({ person_id: id }).del();
      await trx('users').where({ user_id: existing.user_id }).del();
    });
    return res.redirect('/admin/users');
  } catch (error) {
    console.error('Admin delete error:', error);
    return res.redirect('/admin/users');
  }
});

// Start the server and listen on the defined port
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});