import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";

const app = express();
const PORT = process.env.PORT || 5000;

const MONGODB_URI = process.env.MONGODB_URI;
const AUTH_BASE_URL = process.env.AUTH_BASE_URL || "http://localhost:3000";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is missing from .env file");
}

const client = new MongoClient(MONGODB_URI);

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  }),
);

app.use(express.json());

function isValidId(id) {
  return typeof id === "string" && /^[a-fA-F0-9]{24}$/.test(id);
}

function sendError(res, error, message) {
  console.error(message, error);

  return res.status(500).json({
    message,
  });
}

// Verify the user through Better Auth.
// Never trust userId or email supplied in a request body.
async function getAuthenticatedUser(req) {
  const cookie = req.headers.cookie;

  if (!cookie) {
    return null;
  }

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
}

async function startServer() {
  try {
    await client.connect();

    const db = client.db("wanderlust");

    const usersCollection = db.collection("users");
    const destinationsCollection = db.collection("destinations");
    const bookingsCollection = db.collection("bookings");

    console.log("MongoDB connected successfully");

    // Create indexes for common lookups.
    await bookingsCollection.createIndex({
      userId: 1,
      destinationId: 1,
    });

    await bookingsCollection.createIndex({
      createdAt: -1,
    });

    // Save the verified Better Auth user in the Wanderlust users collection.
    async function syncUser(authUser) {
      const now = new Date();

      const createdAt = authUser.createdAt ? new Date(authUser.createdAt) : now;

      const updatedAt = authUser.updatedAt ? new Date(authUser.updatedAt) : now;

      await usersCollection.updateOne(
        { authUserId: String(authUser.id) },
        {
          $set: {
            name: authUser.name || "",
            email: authUser.email,
            updatedAt,
          },
          $setOnInsert: {
            authUserId: String(authUser.id),
            createdAt,
          },
        },
        { upsert: true },
      );

      return usersCollection.findOne({
        authUserId: String(authUser.id),
      });
    }

    // GET all destinations.
    app.get("/destinations", async (req, res) => {
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

    // GET one destination.
    app.get("/destinations/:id", async (req, res) => {
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

    // CREATE destination.
    app.post("/adddestinations", async (req, res) => {
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
          departureDate: departureDate || "",
          imageUrl:
            typeof imageUrl === "string" && imageUrl.trim()
              ? imageUrl.trim()
              : "https://images.unsplash.com/photo-1537996194471-e657df975ab4",
          description:
            typeof description === "string" ? description.trim() : "",
          rating: 4.5,
          createdAt: now,
          updatedAt: now,
        };

        const result = await destinationsCollection.insertOne(newDestination);

        return res.status(201).json({
          message: "Destination created successfully!",
          destination: {
            _id: result.insertedId,
            ...newDestination,
          },
        });
      } catch (error) {
        return sendError(res, error, "Failed to create travel package");
      }
    });

    // UPDATE destination.
    app.patch("/destinations/:id", async (req, res) => {
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
          if (typeof destinationName !== "string" || !destinationName.trim()) {
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
          updates.duration = duration;
        }

        if (departureDate !== undefined) {
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

        const now = new Date();

        updates.updatedAt = now;

        const result = await destinationsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: updates,
            $setOnInsert: {
              createdAt: now,
            },
          },
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({
            message: "Destination not found",
          });
        }

        // Add createdAt only when an older document is missing it.
        await destinationsCollection.updateOne(
          {
            _id: new ObjectId(id),
            createdAt: { $exists: false },
          },
          {
            $set: { createdAt: now },
          },
        );

        const updatedDestination = await destinationsCollection.findOne({
          _id: new ObjectId(id),
        });

        return res.status(200).json({
          message: "Destination updated successfully!",
          destination: updatedDestination,
        });
      } catch (error) {
        return sendError(res, error, "Failed to update destination");
      }
    });

    // DELETE destination.
    app.delete("/destinations/:id", async (req, res) => {
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

        return res.status(200).json({
          message: "Destination deleted successfully!",
        });
      } catch (error) {
        return sendError(res, error, "Failed to delete destination");
      }
    });

    // GET bookings for the currently authenticated user.
    app.get("/bookings", async (req, res) => {
      try {
        const authUser = await getAuthenticatedUser(req);

        if (!authUser) {
          return res.status(401).json({
            message: "Please log in to view your bookings",
          });
        }

        const user = await syncUser(authUser);

        const bookings = await bookingsCollection
          .find({ userId: String(authUser.id) })
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

    // CREATE booking for the currently authenticated user.
    app.post("/bookings", async (req, res) => {
      try {
        const authUser = await getAuthenticatedUser(req);

        if (!authUser) {
          return res.status(401).json({
            message: "Please log in to book a destination",
          });
        }

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

        const user = await syncUser(authUser);

        const destination = await destinationsCollection.findOne({
          _id: new ObjectId(destinationId),
        });

        if (!destination) {
          return res.status(404).json({
            message: "Destination not found",
          });
        }

        const existingBooking = await bookingsCollection.findOne({
          userId: String(authUser.id),
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
          userId: String(authUser.id),
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

        return res.status(201).json({
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

    // UPDATE booking status for the authenticated booking owner.
    app.patch("/bookings/:id", async (req, res) => {
      try {
        const authUser = await getAuthenticatedUser(req);

        if (!authUser) {
          return res.status(401).json({
            message: "Please log in to update your booking",
          });
        }

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
          {
            _id: new ObjectId(id),
            userId: String(authUser.id),
          },
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
          userId: String(authUser.id),
        });

        return res.status(200).json({
          message: "Booking updated successfully!",
          booking,
        });
      } catch (error) {
        return sendError(res, error, "Failed to update booking");
      }
    });

    // GET the currently authenticated user's saved profile.
    app.get("/users/me", async (req, res) => {
      try {
        const authUser = await getAuthenticatedUser(req);

        if (!authUser) {
          return res.status(401).json({
            message: "Please log in to view your profile",
          });
        }

        const user = await syncUser(authUser);

        return res.status(200).json(user);
      } catch (error) {
        return sendError(res, error, "Failed to fetch user profile");
      }
    });

    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  }
}

startServer();
