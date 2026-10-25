import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is missing from .env file");
}

const client = new MongoClient(process.env.MONGODB_URI);

async function startServer() {
  try {
    await client.connect();

    const db = client.db("wanderlust");
    const destinationsCollection = db.collection("destinations");

    console.log("MongoDB connected successfully");

    // Get all destinations
    app.get("/destinations", async (req, res) => {
      try {
        const destinations = await destinationsCollection.find({}).toArray();

        return res.status(200).json(destinations);
      } catch (error) {
        console.error("Error fetching destinations:", error);

        return res.status(500).json({
          message: "Failed to fetch destinations",
        });
      }
    });

    // Get a single destination by ID
    app.get("/destinations/:id", async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id) || !/^[a-fA-F0-9]{24}$/.test(id)) {
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
        console.error("Error fetching destination:", error);

        return res.status(500).json({
          message: "Failed to fetch destination details",
        });
      }
    });

    // Add a new destination
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

        const newDestination = {
          destinationName: destinationName.trim(),
          country: country.trim(),
          category:
            typeof category === "string" && category.trim()
              ? category.trim()
              : "Beach",
          price: numericPrice,
          duration,
          departureDate,
          imageUrl:
            typeof imageUrl === "string" && imageUrl.trim()
              ? imageUrl.trim()
              : "https://images.unsplash.com/photo-1537996194471-e657df975ab4",
          description,
          rating: 4.5,
          createdAt: new Date(),
        };

        const result = await destinationsCollection.insertOne(newDestination);

        return res.status(201).json({
          message: "Package created successfully!",
          package: {
            _id: result.insertedId,
            ...newDestination,
          },
        });
      } catch (error) {
        console.error("Error creating destination:", error);

        return res.status(500).json({
          message: "Failed to create travel package",
        });
      }
    });

    // Update a destination by ID
    app.patch("/destinations/:id", async (req, res) => {
      try {
        const { id } = req.params;

        if (!/^[a-fA-F0-9]{24}$/.test(id)) {
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
          updates.category = category;
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
          updates.imageUrl = imageUrl;
        }

        if (description !== undefined) {
          updates.description = description;
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

        return res.status(200).json({
          message: "Destination updated successfully!",
          destination: updatedDestination,
        });
      } catch (error) {
        console.error("Error updating destination:", error);

        return res.status(500).json({
          message: "Failed to update destination",
        });
      }
    });

    // Delete a destination by ID
    app.delete("/destinations/:id", async (req, res) => {
      try {
        const { id } = req.params;

        if (!/^[a-fA-F0-9]{24}$/.test(id)) {
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
        console.error("Error deleting destination:", error);

        return res.status(500).json({
          message: "Failed to delete destination",
        });
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
