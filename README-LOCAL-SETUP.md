# Local Development Setup

## Prerequisites

1. **Node.js** (v18 or higher)
2. **PostgreSQL** (v12 or higher)

## Database Setup

### Option 1: Local PostgreSQL

1. Start PostgreSQL service:
   ```bash
   sudo systemctl start postgresql
   ```

2. Create a database user and database:
   ```bash
   sudo -u postgres psql
   CREATE USER famflix WITH PASSWORD 'password';
   CREATE DATABASE famflix OWNER famflix;
   GRANT ALL PRIVILEGES ON DATABASE famflix TO famflix;
   \q
   ```

3. Create a `.env` file in the project root:
   ```bash
   cp .env.example .env
   ```

4. Update the DATABASE_URL in `.env`:
   ```
   DATABASE_URL="postgresql://famflix:password@localhost:5432/famflix"
   ```

### Option 2: Neon Cloud Database (Recommended)

1. Go to [Neon](https://neon.tech) and create a free account
2. Create a new project
3. Copy the connection string
4. Create `.env` file and set:
   ```
   DATABASE_URL="your-neon-connection-string"
   ```

## Running the Application

1. Install dependencies:
   ```bash
   npm install
   ```

2. Push database schema:
   ```bash
   npm run db:push
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser to: http://localhost:5000

## Environment Variables

Copy `.env.example` to `.env` and configure:

- `DATABASE_URL`: Your PostgreSQL connection string
- `JWT_SECRET`: A secure random string for JWT tokens
- `OPENAI_API_KEY`: (Optional) For AI features
- `ELEVENLABS_API_KEY`: (Optional) For voice cloning features

## Troubleshooting

- **Database connection errors**: Ensure PostgreSQL is running and the DATABASE_URL is correct
- **Permission errors**: Make sure the database user has proper permissions
- **Port conflicts**: Change the PORT in `.env` if 5000 is already in use
