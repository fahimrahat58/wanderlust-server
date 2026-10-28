import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { MongoClient, ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";
import "dotenv/config";

const app = express();

const PORT = Number(process.env.PORT) || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

const AUTH_BASE_URL = (
  process.env.BETTER_AUTH_URL || process.env.AUTH_BASE_URL
).replace(/\/$/, "");

const FRONTEND_URL = process.env.FRONTEND_URL;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim().toLowerCase();

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is missing from .env");
}

if (!ADMIN_EMAIL) {
  throw new Error("ADMIN_EMAIL is missing from .env");
}

const client = new MongoClient(MONGODB_URI);

const JWKS = createRemoteJWKSet(new URL("/api/auth/jwks", `${AUTH_BASE_URL}/`));

app.use(helmet());

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  }),
);

app.use(express.json({ limit: "1mb" }));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => req.method === "OPTIONS",
  }),
);

function isValidId(id) {
  return typeof id === "string" && /^[a-fA-F0-9]{24}$/.test(id);
}

function sendError(res, error, message) {
  console.error("[API ERROR]", message, error);

  return res.status(500).json({
    success: false,
    message,
  });
}

/* ==========================================
   JWT AUTHENTICATION
========================================== */

async function getAuthenticatedJwtUser(req) {
  console.log("\n========== JWT VERIFICATION ==========");
  console.log("[JWT] Method:", req.method);
  console.log("[JWT] Route:", req.originalUrl);

  const authorization = req.headers.authorization;

  console.log("[JWT] Authorization header present:", Boolean(authorization));

  console.log(
    "[JWT] Bearer token present:",
    Boolean(authorization?.startsWith("Bearer ")),
  );

  if (!authorization?.startsWith("Bearer ")) {
    console.warn("[JWT] FAILED: Bearer token missing");
    console.log("======================================\n");
    return null;
  }

  const token = authorization.slice(7).trim();

  if (!token) {
    console.warn("[JWT] FAILED: Empty token");
    console.log("======================================\n");
    return null;
  }

  console.log("[JWT] Token received. Token value hidden.");
  console.log("[JWT] Verifying signature, issuer and audience...");

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: AUTH_BASE_URL,
      audience: AUTH_BASE_URL,
    });

    console.log("[JWT] Signature and claims verified");
    console.log("[JWT] Issuer:", payload.iss);
    console.log("[JWT] Audience:", payload.aud);
    console.log("[JWT] Subject exists:", Boolean(payload.sub));
    console.log("[JWT] Email exists:", Boolean(payload.email));

    if (!payload.sub || !payload.email) {
      console.error("[JWT] FAILED: Required claims missing");
      console.log("======================================\n");
      return null;
    }

    const user = {
      id: String(payload.sub),
      email: String(payload.email).trim().toLowerCase(),
      name: typeof payload.name === "string" ? payload.name : "",
    };

    console.log("[JWT] VERIFIED SUCCESSFULLY");
    console.log("[JWT] User ID:", user.id);
    console.log("[JWT] User email:", user.email);
    console.log("[JWT] Token value was not printed");
    console.log("======================================\n");

    return user;
  } catch (error) {
    console.error("[JWT] VERIFICATION FAILED");
    console.error("[JWT] Error name:", error.name);
    console.error("[JWT] Error message:", error.message);
    console.log("======================================\n");

    return null;
  }
}

async function requireJwtAuth(req, res, next) {
  console.log("\n========== JWT MIDDLEWARE ==========");
  console.log("[JWT MIDDLEWARE] Checking:", req.method, req.originalUrl);

  try {
    const user = await getAuthenticatedJwtUser(req);

    if (!user) {
      console.error("[JWT MIDDLEWARE] DENIED");
      console.log("[JWT MIDDLEWARE] HTTP 401");
      console.log("====================================\n");

      return res.status(401).json({
        success: false,
        message: "Valid Bearer JWT token required",
      });
    }

    req.user = user;

    console.log("[JWT MIDDLEWARE] AUTHENTICATED");
    console.log("[JWT MIDDLEWARE] User:", user.email);
    console.log("[JWT MIDDLEWARE] Passing to next middleware");
    console.log("====================================\n");

    return next();
  } catch (error) {
    console.error("[JWT MIDDLEWARE] ERROR:", error.message);

    return res.status(401).json({
      success: false,
      message: "Authentication failed",
    });
  }
}

/* ==========================================
   BETTER AUTH SESSION SUPPORT
   Used for regular user endpoints
========================================== */

async function getAuthenticatedUser(req) {
  console.log("\n========== USER AUTHENTICATION ==========");
  console.log("[AUTH] Route:", req.method, req.originalUrl);

  // Prefer a verified Bearer JWT when one is provided.
  const authorization = req.headers.authorization;

  if (authorization?.startsWith("Bearer ")) {
    console.log("[AUTH] Bearer JWT supplied; verifying JWT");

    const jwtUser = await getAuthenticatedJwtUser(req);

    if (jwtUser) {
      console.log("[AUTH] Authenticated using JWT:", jwtUser.email);
      console.log("=========================================\n");
      return jwtUser;
    }

    console.warn("[AUTH] JWT invalid; checking session cookie if available");
  }

  const cookie = req.headers.cookie;

  console.log("[AUTH] Session cookie present:", Boolean(cookie));

  if (!cookie) {
    console.warn("[AUTH] No valid JWT or session cookie");
    console.log("=========================================\n");
    return null;
  }

  try {
    const response = await fetch(`${AUTH_BASE_URL}/api/auth/get-session`, {
      method: "GET",
      headers: {
        cookie,
        accept: "application/json",
      },
      cache: "no-store",
    });

    console.log("[AUTH] Better Auth session HTTP status:", response.status);

    if (!response.ok) {
      console.warn("[AUTH] Session verification failed");
      console.log("=========================================\n");
      return null;
    }

    const data = await response.json();
    const user = data?.user;

    if (!user?.id || !user?.email) {
      console.warn("[AUTH] Session has no valid user");
      console.log("=========================================\n");
      return null;
    }

    const authenticatedUser = {
      ...user,
      id: String(user.id),
      email: String(user.email).trim().toLowerCase(),
    };

    console.log("[AUTH] SESSION VERIFIED");
    console.log("[AUTH] User:", authenticatedUser.email);
    console.log("=========================================\n");

    return authenticatedUser;
  } catch (error) {
    console.error("[AUTH] Session verification error:", error.message);
    console.log("=========================================\n");
    return null;
  }
}

async function requireAuth(req, res, next) {
  console.log("[AUTH MIDDLEWARE] Checking user session or JWT");

  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      console.warn("[AUTH MIDDLEWARE] DENIED: Not authenticated");

      return res.status(401).json({
        success: false,
        message: "Please log in to continue",
      });
    }

    req.user = user;

    console.log("[AUTH MIDDLEWARE] AUTHENTICATED:", user.email);

    return next();
  } catch (error) {
    console.error("[AUTH MIDDLEWARE] ERROR:", error.message);

    return res.status(401).json({
      success: false,
      message: "Authentication failed",
    });
  }
}

/* ==========================================
   ADMIN AUTHORIZATION
========================================== */

function requireAdmin(req, res, next) {
  console.log("\n========== ADMIN AUTHORIZATION ==========");
  console.log("[ADMIN] Route:", req.method, req.originalUrl);
  console.log("[ADMIN] Authenticated user:", req.user?.email);
  console.log("[ADMIN] Admin configuration exists:", Boolean(ADMIN_EMAIL));

  if (!req.user?.email) {
    console.error("[ADMIN] DENIED: No authenticated user");
    console.log("[ADMIN] HTTP 401");
    console.log("=========================================\n");

    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  if (req.user.email.trim().toLowerCase() !== ADMIN_EMAIL) {
    console.error("[ADMIN] DENIED: User is not an admin");
    console.log("[ADMIN] HTTP 403");
    console.log("=========================================\n");

    return res.status(403).json({
      success: false,
      message: "Admin access required",
    });
  }

  console.log("[ADMIN] ACCESS GRANTED");
  console.log("[ADMIN] Admin:", req.user.email);
  console.log("=========================================\n");

  return next();
}

function logProtectedRoute(req, res, next) {
  console.log("\n========== PROTECTED ROUTE ==========");
  console.log("[ROUTE] Access granted:", req.method, req.originalUrl);
  console.log("[ROUTE] User:", req.user?.email);
  console.log("[ROUTE] User ID:", req.user?.id);
  console.log("=====================================\n");

  next();
}

/* ==========================================
   START SERVER
========================================== */

async function startServer() {
  try {
    await client.connect();

    const db = client.db("wanderlust");

    const usersCollection = db.collection("users");
    const destinationsCollection = db.collection("destinations");
    const bookingsCollection = db.collection("bookings");

    await bookingsCollection.createIndex({
      userId: 1,
      createdAt: -1,
    });

    await bookingsCollection.createIndex({
      userId: 1,
      destinationId: 1,
    });

    console.log("[DB] MongoDB connected successfully");
    console.log("[SERVER] Admin email configured:", ADMIN_EMAIL);
    console.log("[SERVER] Better Auth URL:", AUTH_BASE_URL);

    async function syncUser(authUser) {
      const now = new Date();
      const authUserId = String(authUser.id);

      await usersCollection.updateOne(
        { authUserId },
        {
          $set: {
            email: String(authUser.email).trim().toLowerCase(),
            updatedAt: now,
          },
          $setOnInsert: {
            authUserId,
            name: authUser.name || "",
            createdAt: authUser.createdAt ? new Date(authUser.createdAt) : now,
          },
        },
        { upsert: true },
      );

      return usersCollection.findOne({ authUserId });
    }

    /* ---------- HEALTH CHECK ---------- */

    app.get("/", (req, res) => {
      console.log("[PUBLIC] Health check requested");

      return res.status(200).json({
        success: true,
        message: "Wanderlust API is running",
      });
    });

    /* ---------- GET ALL DESTINATIONS ---------- */

    app.get("/destinations", async (req, res) => {
      console.log("[PUBLIC] GET /destinations");

      try {
        const destinations = await destinationsCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();

        return res.status(200).json(destinations);
      } catch (error) {
        return sendError(res, error, "Failed to fetch destinations");
      }
    });

    /* ---------- GET DESTINATION DETAILS ---------- */

    app.get("/destinations/:id", async (req, res) => {
      console.log("[PUBLIC] GET /destinations/:id", req.params.id);

      try {
        const { id } = req.params;

        if (!isValidId(id)) {
          return res.status(400).json({
            message: "Invalid destination ID",
          });
        }

        const destination = await destinationsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!destination) {
          return res.status(404).json({
            message: "Destination not found",
          });
        }

        return res.status(200).json(destination);
      } catch (error) {
        return sendError(res, error, "Failed to fetch destination details");
      }
    });

    /* ---------- ADD DESTINATION: JWT + ADMIN ---------- */

    app.post(
      "/adddestinations",
      requireJwtAuth,
      requireAdmin,
      logProtectedRoute,
      async (req, res) => {
        console.log("[DESTINATION] Creating destination");

        try {
          const {
            destinationName,
            country,
            category,
            price,
            duration,
            departureDate,
            imageUrl,
            description,
          } = req.body;

          if (
            typeof destinationName !== "string" ||
            !destinationName.trim() ||
            typeof country !== "string" ||
            !country.trim() ||
            price === undefined ||
            price === null ||
            price === ""
          ) {
            return res.status(400).json({
              message: "Destination name, country, and price are required",
            });
          }

          const numericPrice = Number(price);

          if (!Number.isFinite(numericPrice) || numericPrice < 0) {
            return res.status(400).json({
              message: "Price must be a valid non-negative number",
            });
          }

          const now = new Date();

          const newDestination = {
            destinationName: destinationName.trim(),
            country: country.trim(),
            category:
              typeof category === "string" && category.trim()
                ? category.trim()
                : "Beach",
            price: numericPrice,
            duration: typeof duration === "string" ? duration.trim() : "",
            departureDate:
              typeof departureDate === "string" ? departureDate : "",
            imageUrl:
              typeof imageUrl === "string" && imageUrl.trim()
                ? imageUrl.trim()
                : "https://images.unsplash.com/photo-1537996194471-e657df975ab4",
            description:
              typeof description === "string" ? description.trim() : "",
            rating: Number.isFinite(Number(req.body.rating))
              ? Math.min(5, Math.max(0, Number(req.body.rating)))
              : 4.5,
            createdAt: now,
            updatedAt: now,
          };

          const result = await destinationsCollection.insertOne(newDestination);

          console.log(
            "[DESTINATION] Created successfully:",
            result.insertedId.toString(),
          );

          return res.status(201).json({
            success: true,
            message: "Destination created successfully!",
            destination: {
              _id: result.insertedId,
              ...newDestination,
            },
          });
        } catch (error) {
          return sendError(res, error, "Failed to create travel package");
        }
      },
    );

    /* ---------- UPDATE DESTINATION: JWT + ADMIN ---------- */

    app.patch(
      "/destinations/:id",
      requireJwtAuth,
      requireAdmin,
      logProtectedRoute,
      async (req, res) => {
        console.log("[DESTINATION] Updating:", req.params.id);

        try {
          const { id } = req.params;

          if (!isValidId(id)) {
            return res.status(400).json({
              message: "Invalid destination ID",
            });
          }

          const {
            destinationName,
            country,
            category,
            price,
            duration,
            departureDate,
            imageUrl,
            description,
            rating,
          } = req.body;

          const updates = {};

          if (destinationName !== undefined) {
            if (
              typeof destinationName !== "string" ||
              !destinationName.trim()
            ) {
              return res.status(400).json({
                message: "Destination name is required",
              });
            }

            updates.destinationName = destinationName.trim();
          }

          if (country !== undefined) {
            if (typeof country !== "string" || !country.trim()) {
              return res.status(400).json({
                message: "Country is required",
              });
            }

            updates.country = country.trim();
          }

          if (category !== undefined) {
            if (typeof category !== "string") {
              return res.status(400).json({
                message: "Category must be a string",
              });
            }

            updates.category = category.trim();
          }

          if (price !== undefined) {
            const numericPrice = Number(price);

            if (
              price === null ||
              price === "" ||
              !Number.isFinite(numericPrice) ||
              numericPrice < 0
            ) {
              return res.status(400).json({
                message: "Price must be a valid non-negative number",
              });
            }

            updates.price = numericPrice;
          }

          if (duration !== undefined) {
            if (typeof duration !== "string") {
              return res.status(400).json({
                message: "Duration must be a string",
              });
            }

            updates.duration = duration.trim();
          }

          if (departureDate !== undefined) {
            if (typeof departureDate !== "string") {
              return res.status(400).json({
                message: "Departure date must be a string",
              });
            }

            updates.departureDate = departureDate;
          }

          if (imageUrl !== undefined) {
            if (typeof imageUrl !== "string") {
              return res.status(400).json({
                message: "Image URL must be a string",
              });
            }

            updates.imageUrl = imageUrl.trim();
          }

          if (description !== undefined) {
            if (typeof description !== "string") {
              return res.status(400).json({
                message: "Description must be a string",
              });
            }

            updates.description = description.trim();
          }

          if (rating !== undefined) {
            const numericRating = Number(rating);

            if (
              rating === null ||
              rating === "" ||
              !Number.isFinite(numericRating) ||
              numericRating < 0 ||
              numericRating > 5
            ) {
              return res.status(400).json({
                message: "Rating must be between 0 and 5",
              });
            }

            updates.rating = numericRating;
          }

          if (Object.keys(updates).length === 0) {
            return res.status(400).json({
              message: "Please provide at least one field to update",
            });
          }

          updates.updatedAt = new Date();

          const result = await destinationsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: updates },
          );

          if (result.matchedCount === 0) {
            return res.status(404).json({
              message: "Destination not found",
            });
          }

          const updatedDestination = await destinationsCollection.findOne({
            _id: new ObjectId(id),
          });

          console.log("[DESTINATION] Updated successfully:", id);

          return res.status(200).json({
            success: true,
            message: "Destination updated successfully!",
            destination: updatedDestination,
          });
        } catch (error) {
          return sendError(res, error, "Failed to update destination");
        }
      },
    );

    /* ---------- DELETE DESTINATION: JWT + ADMIN ---------- */

    app.delete(
      "/destinations/:id",
      requireJwtAuth,
      requireAdmin,
      logProtectedRoute,
      async (req, res) => {
        console.log("[DESTINATION] Deleting:", req.params.id);

        try {
          const { id } = req.params;

          if (!isValidId(id)) {
            return res.status(400).json({
              message: "Invalid destination ID",
            });
          }

          const result = await destinationsCollection.deleteOne({
            _id: new ObjectId(id),
          });

          if (result.deletedCount === 0) {
            return res.status(404).json({
              message: "Destination not found",
            });
          }

          console.log("[DESTINATION] Deleted successfully:", id);

          return res.status(200).json({
            success: true,
            message: "Destination deleted successfully!",
          });
        } catch (error) {
          return sendError(res, error, "Failed to delete destination");
        }
      },
    );

    /* ---------- GET PROFILE: JWT ---------- */

    app.get("/users/me", requireJwtAuth, async (req, res) => {
      console.log("[PROFILE] Fetching profile:", req.user.email);

      try {
        const user = await syncUser(req.user);

        if (!user) {
          return res.status(404).json({
            message: "User not found",
          });
        }

        return res.status(200).json({
          ...user,
          isAdmin: req.user.email === ADMIN_EMAIL,
        });
      } catch (error) {
        return sendError(res, error, "Failed to fetch user profile");
      }
    });

    /* ---------- UPDATE PROFILE: JWT ---------- */

    app.patch("/users/me", requireJwtAuth, async (req, res) => {
      console.log("[PROFILE] Updating profile:", req.user.email);

      try {
        const { name, profileImage, nationality } = req.body;
        const updates = { updatedAt: new Date() };

        if (name !== undefined) {
          if (typeof name !== "string" || !name.trim()) {
            return res.status(400).json({
              message: "Name must not be empty",
            });
          }

          updates.name = name.trim();
        }

        if (profileImage !== undefined) {
          if (typeof profileImage !== "string") {
            return res.status(400).json({
              message: "Profile image must be a string",
            });
          }

          updates.profileImage = profileImage.trim();
        }

        if (nationality !== undefined) {
          if (typeof nationality !== "string") {
            return res.status(400).json({
              message: "Nationality must be a string",
            });
          }

          updates.nationality = nationality.trim();
        }

        if (Object.keys(updates).length === 1) {
          return res.status(400).json({
            message: "Please provide profile fields to update",
          });
        }

        await usersCollection.updateOne(
          { authUserId: req.user.id },
          {
            $set: updates,
            $setOnInsert: {
              authUserId: req.user.id,
              email: req.user.email,
              createdAt: new Date(),
            },
          },
          { upsert: true },
        );

        const user = await usersCollection.findOne({
          authUserId: req.user.id,
        });

        console.log("[PROFILE] Updated successfully:", req.user.email);

        return res.status(200).json({
          success: true,
          message: "Profile updated successfully",
          user,
          isAdmin: req.user.email === ADMIN_EMAIL,
        });
      } catch (error) {
        return sendError(res, error, "Failed to update profile");
      }
    });

    /* ---------- GET OWN BOOKINGS: JWT ---------- */

    app.get("/bookings", requireJwtAuth, async (req, res) => {
      console.log("[BOOKINGS] Fetching bookings for:", req.user.email);

      try {
        const user = await syncUser(req.user);

        const bookings = await bookingsCollection
          .find({ userId: req.user.id })
          .sort({ createdAt: -1 })
          .toArray();

        return res.status(200).json({
          user,
          bookings,
        });
      } catch (error) {
        return sendError(res, error, "Failed to fetch bookings");
      }
    });

    /* ---------- CREATE BOOKING: AUTHENTICATED ---------- */

    app.post("/bookings", requireAuth, async (req, res) => {
      console.log("[BOOKINGS] Creating booking for:", req.user.email);

      try {
        const { destinationId, departure } = req.body;

        if (!isValidId(destinationId)) {
          return res.status(400).json({
            message: "Invalid destination ID",
          });
        }

        if (
          typeof departure !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(departure)
        ) {
          return res.status(400).json({
            message: "A valid departure date is required",
          });
        }

        const user = await syncUser(req.user);

        const destination = await destinationsCollection.findOne({
          _id: new ObjectId(destinationId),
        });

        if (!destination) {
          return res.status(404).json({
            message: "Destination not found",
          });
        }

        const existingBooking = await bookingsCollection.findOne({
          userId: req.user.id,
          destinationId: String(destination._id),
          status: { $ne: "Cancelled" },
        });

        if (existingBooking) {
          return res.status(409).json({
            message: "You have already booked this destination",
          });
        }

        const now = new Date();

        const booking = {
          userId: req.user.id,
          email: user.email,
          destinationId: String(destination._id),
          title: destination.destinationName,
          image: destination.imageUrl || "",
          departure,
          bookingId: `WB-${Date.now()}-${new ObjectId().toString().slice(-6)}`,
          price: Number(destination.price),
          status: "Pending",
          createdAt: now,
          updatedAt: now,
        };

        const result = await bookingsCollection.insertOne(booking);

        console.log(
          "[BOOKINGS] Created successfully:",
          result.insertedId.toString(),
        );

        return res.status(201).json({
          success: true,
          message: "Booking saved successfully!",
          booking: {
            _id: result.insertedId,
            ...booking,
          },
        });
      } catch (error) {
        return sendError(res, error, "Failed to create booking");
      }
    });

    /* ---------- CANCEL OWN BOOKING: JWT ---------- */

    app.patch("/bookings/:id", requireJwtAuth, async (req, res) => {
      console.log("[BOOKINGS] User booking update:", req.user.email);

      try {
        const { id } = req.params;
        const { status } = req.body;

        if (!isValidId(id)) {
          return res.status(400).json({
            message: "Invalid booking ID",
          });
        }

        if (status !== "Cancelled") {
          return res.status(403).json({
            message: "Users can only cancel their own bookings",
          });
        }

        const result = await bookingsCollection.updateOne(
          {
            _id: new ObjectId(id),
            userId: req.user.id,
          },
          {
            $set: {
              status: "Cancelled",
              updatedAt: new Date(),
            },
          },
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({
            message: "Booking not found",
          });
        }

        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(id),
          userId: req.user.id,
        });

        console.log("[BOOKINGS] Cancelled successfully:", id);

        return res.status(200).json({
          success: true,
          message: "Booking cancelled successfully",
          booking,
        });
      } catch (error) {
        return sendError(res, error, "Failed to cancel booking");
      }
    });

    /* ---------- DELETE OWN CANCELLED BOOKING: JWT ---------- */

    app.delete("/bookings/:id", requireJwtAuth, async (req, res) => {
      console.log("[BOOKINGS] Removing booking:", req.params.id);
      console.log("[BOOKINGS] Requested by:", req.user.email);

      try {
        const { id } = req.params;

        if (!isValidId(id)) {
          return res.status(400).json({
            success: false,
            message: "Invalid booking ID",
          });
        }

        const result = await bookingsCollection.deleteOne({
          _id: new ObjectId(id),
          userId: req.user.id,
          status: "Cancelled",
        });

        if (result.deletedCount === 0) {
          return res.status(404).json({
            success: false,
            message:
              "Cancelled booking not found or you are not authorized to remove it.",
          });
        }

        console.log("[BOOKINGS] Removed successfully:", id);

        return res.status(200).json({
          success: true,
          message: "Booking removed successfully!",
        });
      } catch (error) {
        return sendError(res, error, "Failed to remove booking");
      }
    });

    /* ---------- ADMIN: GET ALL USERS ---------- */

    app.get(
      "/admin/users",
      requireJwtAuth,
      requireAdmin,
      logProtectedRoute,
      async (req, res) => {
        console.log("[ADMIN USERS] Fetching all users");

        try {
          const users = await usersCollection
            .find({})
            .sort({ createdAt: -1 })
            .toArray();

          return res.status(200).json(
            users.map((user) => ({
              ...user,
              isAdmin: user.email?.trim().toLowerCase() === ADMIN_EMAIL,
            })),
          );
        } catch (error) {
          return sendError(res, error, "Failed to fetch users");
        }
      },
    );

    /* ---------- ADMIN: GET ALL BOOKINGS ---------- */

    app.get(
      "/admin/bookings",
      requireJwtAuth,
      requireAdmin,
      logProtectedRoute,
      async (req, res) => {
        console.log("[ADMIN BOOKINGS] Fetching all bookings");

        try {
          const bookings = await bookingsCollection
            .find({})
            .sort({ createdAt: -1 })
            .toArray();

          return res.status(200).json(bookings);
        } catch (error) {
          return sendError(res, error, "Failed to fetch all bookings");
        }
      },
    );

    /* ---------- ADMIN: UPDATE BOOKING ---------- */

    app.patch(
      "/admin/bookings/:id",
      requireJwtAuth,
      requireAdmin,
      logProtectedRoute,
      async (req, res) => {
        console.log("[ADMIN BOOKINGS] Updating booking:", req.params.id);

        try {
          const { id } = req.params;
          const { status } = req.body;

          if (!isValidId(id)) {
            return res.status(400).json({
              message: "Invalid booking ID",
            });
          }

          if (!["Pending", "Confirmed", "Cancelled"].includes(status)) {
            return res.status(400).json({
              message: "Invalid booking status",
            });
          }

          const result = await bookingsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                status,
                updatedAt: new Date(),
              },
            },
          );

          if (result.matchedCount === 0) {
            return res.status(404).json({
              message: "Booking not found",
            });
          }

          const booking = await bookingsCollection.findOne({
            _id: new ObjectId(id),
          });

          console.log("[ADMIN BOOKINGS] Updated successfully:", id);

          return res.status(200).json({
            success: true,
            message: "Booking status updated successfully",
            booking,
          });
        } catch (error) {
          return sendError(res, error, "Failed to update booking status");
        }
      },
    );

    /* ---------- NOT FOUND ---------- */

    app.use((req, res) => {
      console.warn("[404] Route not found:", req.method, req.originalUrl);

      return res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`,
      });
    });

    app.listen(PORT, () => {
      console.log("\n========================================");
      console.log("WANDERLUST BACKEND STARTED");
      console.log(`API: http://localhost:${PORT}`);
      console.log("MongoDB: Connected");
      console.log("JWT verification: Enabled");
      console.log("Admin route protection: Enabled");
      console.log("JWT token values: Hidden");
      console.log("========================================\n");
    });
  } catch (error) {
    console.error("[SERVER] Startup failed:", error);
    await client.close().catch(() => {});
    process.exit(1);
  }
}

startServer();
