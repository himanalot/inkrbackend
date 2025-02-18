import express from 'express';
import cors from 'cors';
import axios from 'axios';
import xlsx from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;
const isDevelopment = process.env.NODE_ENV !== 'production';

// CORS configuration
const corsOptions = {
  origin: isDevelopment 
    ? 'http://localhost:5173' // Development frontend URL
    : ['https://inkr.netlify.app'], // Your Netlify URL
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
};

app.use(cors(corsOptions));
app.use(express.json());

const NIH_API_URL = 'https://api.reporter.nih.gov/v2/projects/search';

// Load email database
let emailDatabase = null;
try {
  // In Railway, files are in the /app directory
  const emailDbPath = isDevelopment
    ? path.join(__dirname, '2022-pi-email-report.xlsx')
    : path.join('/app', '2022-pi-email-report.xlsx');

  console.log('Loading email database from:', emailDbPath);
  console.log('Current directory:', __dirname);
  console.log('Files in directory:', require('fs').readdirSync(__dirname));
  
  const workbook = xlsx.readFile(emailDbPath);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  emailDatabase = xlsx.utils.sheet_to_json(worksheet);
  console.log(`Loaded email database with ${emailDatabase.length} entries`);
} catch (error) {
  console.error('Error loading email database:', error);
  console.error('Current directory:', __dirname);
  try {
    console.error('Files in /app:', require('fs').readdirSync('/app'));
  } catch (e) {
    console.error('Error listing /app directory:', e);
  }
}

function findPIEmail(firstName, lastName) {
  if (!emailDatabase) return null;

  try {
    // Case-insensitive search
    const matches = emailDatabase.filter(row => {
      const rowFirstName = String(row['Contact PI First Name'] || '').trim().toUpperCase();
      const rowLastName = String(row['Contact PI Last Name'] || '').trim().toUpperCase();
      const searchFirstName = String(firstName || '').trim().toUpperCase();
      const searchLastName = String(lastName || '').trim().toUpperCase();
      
      return rowFirstName === searchFirstName && rowLastName === searchLastName;
    });

    if (matches.length === 0) {
      // Try searching by full name as backup
      const fullName = `${firstName} ${lastName}`.toUpperCase();
      const fullNameMatches = emailDatabase.filter(row => {
        const piNames = String(row['PI Name(s) All'] || '').toUpperCase();
        return piNames.includes(fullName);
      });
      
      if (fullNameMatches.length > 0) {
        // Get unique emails
        const uniqueEmails = [...new Set(
          fullNameMatches
            .map(match => match['Contact PI Email'])
            .filter(email => email && email.trim())
            .map(email => email.trim().toLowerCase())
        )];
        return uniqueEmails.join('; ');
      }
      return null;
    }

    // Get unique emails
    const uniqueEmails = [...new Set(
      matches
        .map(match => match['Contact PI Email'])
        .filter(email => email && email.trim())
        .map(email => email.trim().toLowerCase())
    )];
    return uniqueEmails.join('; ');
  } catch (error) {
    console.error('Error finding PI email:', error);
    return null;
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    environment: isDevelopment ? 'development' : 'production',
    emailDatabaseSize: emailDatabase?.length || 0
  });
});

// API routes
app.post('/api/search', async (req, res) => {
  console.log('Received search request:', req.body);
  
  try {
    console.log('Making request to NIH API...');
    const response = await axios.post(NIH_API_URL, req.body);
    console.log(`Received ${response.data.results?.length || 0} results from NIH API`);

    if (!response.data.results) {
      throw new Error('No results array in NIH API response');
    }

    const results = response.data.results;

    // Add email information to each result
    console.log('Processing results and adding email information...');
    const resultsWithEmail = results.map(project => {
      const pi = project.principal_investigators[0];
      if (pi) {
        const email = findPIEmail(pi.first_name, pi.last_name);
        console.log(`Found email for ${pi.first_name} ${pi.last_name}:`, email || 'not found');
        return {
          ...project,
          principal_investigators: [
            {
              ...pi,
              email: email || 'Email not found in database'
            },
            ...project.principal_investigators.slice(1)
          ]
        };
      }
      return project;
    });

    console.log('Sending response back to client...');
    res.json({ ...response.data, results: resultsWithEmail });
  } catch (error) {
    console.error('Error in /api/search:', error);
    console.error('Error details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    
    res.status(500).json({ 
      error: 'Failed to fetch research opportunities. Please try again.',
      details: error.message,
      status: error.response?.status
    });
  }
});

// Serve static files from the React app
// Important: This must come AFTER API routes
app.use(express.static(path.join(__dirname)));

// Handle React routing, return all requests to React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running in ${isDevelopment ? 'development' : 'production'} mode`);
  console.log(`Server listening at http://localhost:${port}`);
}); 