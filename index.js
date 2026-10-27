import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";

const app = express();
const PORT = process.env.PORT || 5000;

const MONGODB_URI = process.env.MONGODB_URI;
const AUTH_BASE_URL =
  process.env.AUTH_BASE_URL || "http://localhost:3000";
const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim().toLowerCase();

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is missing from .env");
}

if (!ADMIN_EMAIL) {
  throw new Error("ADMIN_EMAIL is missing from .env");
}

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  }),
);

app.use(express.json({ limit: "1mb" }));

const client = new MongoClient(MONGODB_URI);

let usersCollection;
let destinationsCollection;
let bookingsCollection;

const isValidObjectId = (id) =>
  typeof id === "string" && /^[a-fA-F0-9]{24}$/.test(id);

const toObjectId = (id) => new ObjectId(id);

function sendError(res, status, message) {
  return res.status(status).json({ message });
}

function getString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function isValidHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/* ---------------- AUTHENTICATION ---------------- */

async function getAuthenticatedUser(req) {
  const cookie = req.headers.cookie;

  if (!cookie) {
    return null;
  }

  try {
    const response = await fetch(
      `${AUTH_BASE_URL.replace(/\/$/, "")}/api/auth/get-session`,
      {
        method: "GET",
        headers: {
          cookie,
          accept: "application/json",
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const user = data?.user;

    if (!user?.id || !user?.email) {
      return null;
    }

    return user;
  } catch (error) {
    console.error("Better Auth session verification failed:", error);
    return null;
  }
}

/* ---------------- USER SYNC ---------------- */

async function syncUser(authUser) {
  const now = new Date();
  const email = authUser.email.trim().toLowerCase();
  const authUserId = String(authUser.id);
  const role = email === ADMIN_EMAIL ? "admin" : "user";

  const existingUser = await usersCollection.findOne({
    authUserId,
  });

  if (existingUser) {
    // Keep the saved profile name and other profile fields.
    // Only sync the verified email and server-derived role.
    await usersCollection.updateOne(
      { authUserId },
      {
        $set: {
          email,
          role,
          updatedAt: now,
        },
      },
    );
  } else {
    await usersCollection.updateOne(
      { authUserId },
      {
        $setOnInsert: {
          authUserId,
          name: getString(authUser.name),
          email,
          role,
          profileImage: "",
          nationality: "",
          createdAt: authUser.createdAt
            ? new Date(authUser.createdAt)
            : now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
  }

  return usersCollection.findOne({ authUserId });
}

/* ---------------- AUTH HELPERS ---------------- */

async function requireAuth(req, res) {
  const authUser = await getAuthenticatedUser(req);

  if (!authUser) {
    sendError(res, 401, "Please sign in first.");
    return null;
  }

  try {
    const user = await syncUser(authUser);

    if (!user) {
      sendError(res, 401, "Unable to verify user.");
      return null;
    }

    req.authUser = authUser;
    req.dbUser = user;

    return user;
  } catch (error) {
    console.error("User synchronization failed:", error);
    sendError(res, 500, "Failed to verify user.");
    return null;
  }
}

async function requireAdmin(req, res) {
  const user = await requireAuth(req, res);

  if (!user) {
    return null;
  }

  if (user.role !== "admin") {
    sendError(res, 403, "Admin access required.");
    return null;
  }

  return user;
}

/* ---------------- DESTINATION VALIDATION ---------------- */

function validateDestination(body, partial = false) {
  const errors = [];

  const requiredFields = [
    "destinationName",
    "country",
    "category",
    "price",
    "duration",
    "departureDate",
    "imageUrl",
    "description",
  ];

  if (!partial) {
    for (const field of requiredFields) {
      if (body[field] === undefined || body[field] === null) {
        errors.push(`${field} is required.`);
      }
    }
  }

  const stringFields = [
    "destinationName",
    "country",
    "category",
    "duration",
    "departureDate",
    "imageUrl",
    "description",
  ];

  for (const field of stringFields) {
    if (body[field] === undefined) continue;

    if (typeof body[field] !== "string") {
      errors.push(`${field} must be a string.`);
      continue;
    }

    if (
      !partial &&
      field !== "description" &&
      !body[field].trim()
    ) {
      errors.push(`${field} cannot be empty.`);
    }
  }

  if (body.price !== undefined) {
    const price = Number(body.price);

    if (!Number.isFinite(price) || price < 0) {
      errors.push("Price must be a valid non-negative number.");
    }
  }

  if (body.rating !== undefined) {
    const rating = Number(body.rating);

    if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
      errors.push("Rating must be between 0 and 5.");
    }
  }

  if (
    body.departureDate !== undefined &&
    !isValidDate(body.departureDate)
  ) {
    errors.push("Departure date must use YYYY-MM-DD format.");
  }

  if (
    body.imageUrl !== undefined &&
    body.imageUrl.trim() &&
    !isValidHttpUrl(body.imageUrl)
  ) {
    errors.push("Image URL must be a valid HTTP or HTTPS URL.");
  }

  return errors;
}

function buildDestination(body, existing = {}) {
  const destination = { ...existing };

  const stringFields = [
    "destinationName",
    "country",
    "category",
    "duration",
    "departureDate",
    "imageUrl",
    "description",
  ];

  for (const field of stringFields) {
    if (body[field] !== undefined) {
      destination[field] = body[field].trim();
    }
  }

  if (body.price !== undefined) {
    destination.price = Number(body.price);
  }

  if (body.rating !== undefined) {
    destination.rating = Number(body.rating);
  }

  return destination;
}

/* ---------------- HEALTH CHECK ---------------- */

app.get("/", (req, res) => {
  res.json({
    message: "Wanderlust API is running.",
    status: "ok",
  });
});

/* ---------------- DESTINATIONS ---------------- */

// Get all destinations
app.get("/destinations", async (req, res) => {
  try {
    const destinations = await destinationsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.json(destinations);
  } catch (error) {
    console.error("Get destinations error:", error);
    sendError(res, 500, "Failed to fetch destinations.");
  }
});

// Get a single destination
app.get("/destinations/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return sendError(res, 400, "Invalid destination ID.");
    }

    const destination = await destinationsCollection.findOne({
      _id: toObjectId(id),
    });

    if (!destination) {
      return sendError(res, 404, "Destination not found.");
    }

    res.json(destination);
  } catch (error) {
    console.error("Get destination error:", error);
    sendError(res, 500, "Failed to fetch destination.");
  }
});

// Add destination - ADMIN ONLY
app.post("/adddestinations", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const errors = validateDestination(req.body);

    if (errors.length) {
      return res.status(400).json({
        message: "Invalid destination data.",
        errors,
      });
    }

    const now = new Date();

    const destination = {
      ...buildDestination(req.body),
      rating:
        req.body.rating === undefined ? 0 : Number(req.body.rating),
      createdAt: now,
      updatedAt: now,
      createdBy: admin.authUserId,
    };

    const result = await destinationsCollection.insertOne(destination);

    res.status(201).json({
      message: "Destination added successfully.",
      destination: {
        ...destination,
        _id: result.insertedId,
      },
    });
  } catch (error) {
    console.error("Add destination error:", error);
    sendError(res, 500, "Failed to add destination.");
  }
});

// Update destination - ADMIN ONLY
app.patch("/destinations/:id", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return sendError(res, 400, "Invalid destination ID.");
    }

    const errors = validateDestination(req.body, true);

    if (errors.length) {
      return res.status(400).json({
        message: "Invalid destination data.",
        errors,
      });
    }

    const destinationId = toObjectId(id);

    const existing = await destinationsCollection.findOne({
      _id: destinationId,
    });

    if (!existing) {
      return sendError(res, 404, "Destination not found.");
    }

    const updatedDestination = buildDestination(req.body, existing);
    updatedDestination.updatedAt = new Date();

    await destinationsCollection.updateOne(
      { _id: destinationId },
      { $set: updatedDestination },
    );

    const destination = await destinationsCollection.findOne({
      _id: destinationId,
    });

    res.json({
      message: "Destination updated successfully.",
      destination,
    });
  } catch (error) {
    console.error("Update destination error:", error);
    sendError(res, 500, "Failed to update destination.");
  }
});

// Delete destination - ADMIN ONLY
app.delete("/destinations/:id", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return sendError(res, 400, "Invalid destination ID.");
    }

    const result = await destinationsCollection.deleteOne({
      _id: toObjectId(id),
    });

    if (!result.deletedCount) {
      return sendError(res, 404, "Destination not found.");
    }

    res.json({
      message: "Destination deleted successfully.",
    });
  } catch (error) {
    console.error("Delete destination error:", error);
    sendError(res, 500, "Failed to delete destination.");
  }
});

/* ---------------- USER PROFILE ---------------- */

// Get current user's profile
app.get("/users/me", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    res.json({ user });
  } catch (error) {
    console.error("Get profile error:", error);
    sendError(res, 500, "Failed to fetch profile.");
  }
});

// Update current user's profile
app.patch("/users/me", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const { name, profileImage, nationality } = req.body;
    const updates = {};

    if (name !== undefined) {
      if (
        typeof name !== "string" ||
        !name.trim() ||
        name.trim().length > 100
      ) {
        return sendError(
          res,
          400,
          "Name must be between 1 and 100 characters.",
        );
      }

      updates.name = name.trim();
    }

    if (profileImage !== undefined) {
      if (
        typeof profileImage !== "string" ||
        profileImage.length > 2048
      ) {
        return sendError(res, 400, "Invalid profile image URL.");
      }

      const image = profileImage.trim();

      if (image && !isValidHttpUrl(image)) {
        return sendError(
          res,
          400,
          "Profile image must be a valid HTTP or HTTPS URL.",
        );
      }

      updates.profileImage = image;
    }

    if (nationality !== undefined) {
      if (
        typeof nationality !== "string" ||
        nationality.trim().length > 80
      ) {
        return sendError(res, 400, "Invalid nationality.");
      }

      updates.nationality = nationality.trim();
    }

    if (Object.keys(updates).length === 0) {
      return sendError(res, 400, "No valid profile fields provided.");
    }

    updates.updatedAt = new Date();

    await usersCollection.updateOne(
      { authUserId: user.authUserId },
      { $set: updates },
    );

    const updatedUser = await usersCollection.findOne({
      authUserId: user.authUserId,
    });

    res.json({
      message: "Profile updated successfully.",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Update profile error:", error);
    sendError(res, 500, "Failed to update profile.");
  }
});

/* ---------------- USER BOOKINGS ---------------- */

// Get current user's bookings
app.get("/bookings", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const bookings = await bookingsCollection
      .find({ userId: user.authUserId })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      user: {
        id: user.authUserId,
        name: user.name,
        email: user.email,
      },
      bookings,
    });
  } catch (error) {
    console.error("Get bookings error:", error);
    sendError(res, 500, "Failed to fetch bookings.");
  }
});

// Create a booking for the logged-in user
app.post("/bookings", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const destinationId = getString(req.body.destinationId);
    const departure = getString(req.body.departure);

    if (!isValidObjectId(destinationId)) {
      return sendError(res, 400, "Invalid destination ID.");
    }

    if (departure && !isValidDate(departure)) {
      return sendError(
        res,
        400,
        "Departure date must use YYYY-MM-DD format.",
      );
    }

    const destination = await destinationsCollection.findOne({
      _id: toObjectId(destinationId),
    });

    if (!destination) {
      return sendError(res, 404, "Destination not found.");
    }

    const existingBooking = await bookingsCollection.findOne({
      userId: user.authUserId,
      destinationId,
      status: { $nin: ["Cancelled", "Rejected"] },
    });

    if (existingBooking) {
      return sendError(
        res,
        409,
        "You already have an active booking for this destination.",
      );
    }

    const now = new Date();

    const booking = {
      userId: user.authUserId,
      userEmail: user.email,
      userName: user.name || "",
      destinationId,
      destinationName: destination.destinationName,
      country: destination.country || "",
      imageUrl: destination.imageUrl || "",
      price: Number(destination.price) || 0,
      departure: departure || destination.departureDate || "",
      duration: destination.duration || "",
      status: "Pending",
      createdAt: now,
      updatedAt: now,
    };

    const result = await bookingsCollection.insertOne(booking);

    res.status(201).json({
      message: "Booking created successfully.",
      booking: {
        ...booking,
        _id: result.insertedId,
      },
    });
  } catch (error) {
    console.error("Create booking error:", error);
    sendError(res, 500, "Failed to create booking.");
  }
});

// Cancel own booking
app.patch("/bookings/:id", async (req, res) => {
  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return sendError(res, 400, "Invalid booking ID.");
    }

    const bookingId = toObjectId(id);

    const booking = await bookingsCollection.findOne({
      _id: bookingId,
      userId: user.authUserId,
    });

    if (!booking) {
      return sendError(res, 404, "Booking not found.");
    }

    if (booking.status === "Cancelled") {
      return sendError(res, 400, "Booking is already cancelled.");
    }

    await bookingsCollection.updateOne(
      {
        _id: bookingId,
        userId: user.authUserId,
      },
      {
        $set: {
          status: "Cancelled",
          updatedAt: new Date(),
        },
      },
    );

    const updatedBooking = await bookingsCollection.findOne({
      _id: bookingId,
    });

    res.json({
      message: "Booking cancelled successfully.",
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Cancel booking error:", error);
    sendError(res, 500, "Failed to cancel booking.");
  }
});

/* ---------------- ADMIN BOOKINGS ---------------- */

// Get all bookings - ADMIN ONLY
app.get("/admin/bookings", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const bookings = await bookingsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.json(bookings);
  } catch (error) {
    console.error("Admin get bookings error:", error);
    sendError(res, 500, "Failed to fetch all bookings.");
  }
});

// Update booking status - ADMIN ONLY
app.patch("/admin/bookings/:id", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const status = getString(req.body.status);

    const allowedStatuses = [
      "Pending",
      "Confirmed",
      "Cancelled",
      "Rejected",
      "Completed",
    ];

    if (!isValidObjectId(id)) {
      return sendError(res, 400, "Invalid booking ID.");
    }

    if (!allowedStatuses.includes(status)) {
      return sendError(res, 400, "Invalid booking status.");
    }

    const bookingId = toObjectId(id);

    const result = await bookingsCollection.updateOne(
      { _id: bookingId },
      {
        $set: {
          status,
          updatedAt: new Date(),
          updatedBy: admin.authUserId,
        },
      },
    );

    if (!result.matchedCount) {
      return sendError(res, 404, "Booking not found.");
    }

    const booking = await bookingsCollection.findOne({
      _id: bookingId,
    });

    res.json({
      message: "Booking status updated successfully.",
      booking,
    });
  } catch (error) {
    console.error("Admin update booking error:", error);
    sendError(res, 500, "Failed to update booking.");
  }
});

/* ---------------- ADMIN USERS ---------------- */

// Get users - ADMIN ONLY
app.get("/admin/users", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const users = await usersCollection
      .find(
        {},
        {
          projection: {
            authUserId: 1,
            name: 1,
            email: 1,
            role: 1,
            profileImage: 1,
            nationality: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      )
      .sort({ createdAt: -1 })
      .toArray();

    res.json(users);
  } catch (error) {
    console.error("Admin get users error:", error);
    sendError(res, 500, "Failed to fetch users.");
  }
});

/* ---------------- 404 HANDLER ---------------- */

app.use((req, res) => {
  res.status(404).json({
    message: "API route not found.",
    path: req.originalUrl,
  });
});

/* ---------------- ERROR HANDLER ---------------- */

app.use((error, req, res, next) => {
  console.error("Unhandled server error:", error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    message: "Internal server error.",
  });
});

/* ---------------- START SERVER ---------------- */

async function startServer() {
  try {
    await client.connect();

    const database = client.db("wanderlust");

    usersCollection = database.collection("users");
    destinationsCollection = database.collection("destinations");
    bookingsCollection = database.collection("bookings");

    // IMPORTANT:
    // Existing authUserId_1 index is unique without sparse.
    // Use the same options to avoid IndexKeySpecsConflict.
    await usersCollection.createIndex(
      { authUserId: 1 },
      { unique: true },
    );

    await bookingsCollection.createIndex({
      userId: 1,
      createdAt: -1,
    });

    await bookingsCollection.createIndex({
      destinationId: 1,
      userId: 1,
    });

    app.listen(PORT, () => {
      console.log(`Wanderlust API running on http://localhost:${PORT}`);
      console.log(`Better Auth URL: ${AUTH_BASE_URL}`);
      console.log(`Frontend URL: ${FRONTEND_URL}`);
      console.log(`Admin email configured: ${ADMIN_EMAIL}`);
    });
  } catch (error) {
    console.error("Failed to start Wanderlust API:", error);

    try {
      await client.close();
    } catch {
      // Ignore connection cleanup errors.
    }

    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  await client.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await client.close();
  process.exit(0);
});

startServer();