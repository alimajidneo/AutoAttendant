import { defineConfig } from "drizzle-kit";
import { databaseConnection } from "./src/db/connection.js";

const connection = databaseConnection(process.env.DATABASE_URL!);

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: connection.connectionString!, ssl: connection.ssl },
});
