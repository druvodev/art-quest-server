require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;

  // check user authorization
  if (!authorization) {
    return res.status(401).json({ error: true, message: "unauthorize access" });
  }

  // get bearer token
  const token = authorization.split(" ")[1];

  // verify jwt token
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .json({ error: true, message: "unauthorize access" });
    }
    req.decoded = decoded;
    next();
  });
};

// ------------------

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.18ceobk.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const database = client.db("artQuestDB");
    const userCollection = database.collection("users");
    const classCollection = database.collection("classes");
    const paymentCollection = database.collection("paymentHistory");

    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.json({ token });
    });

    // verify admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);

      if (user?.role !== "admin") {
        return res
          .status(403)
          .json({ error: true, message: "forbidden message" });
      }
      next();
    };
    // verify instructor
    const verifyInstructor = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);

      if (user?.role !== "instructor") {
        return res
          .status(403)
          .json({ error: true, message: "forbidden message" });
      }
      next();
    };

    // Upload every new students info in database
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "student";
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.json({ message: "user already exists" });
      }
      const result = await userCollection.insertOne(user);
      res.json(result);
    });

    // ------------Student Methods------------
    // Check Student
    app.get("/users/student/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.json({ student: false });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      const result = { student: user?.role === "student" };
      res.json(result);
    });

    // ------------Admin Methods------------
    // Check Admin
    app.get("/users/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.json({ admin: false });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      const result = { admin: user?.role === "admin" };
      res.json(result);
    });
    // send all users
    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.json(result);
    });
    // send all classes
    app.get("/admin/classes", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await classCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.json(result);
    });

    // Generate new admin
    app.patch("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.json(result);
    });
    // Generate new instructor
    app.patch(
      "/users/instructor/:id",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "instructor",
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.json(result);
      }
    );
    // Approved or Deny Classes
    app.patch("/admin/class/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const body = req.body;
      const classMethod = body.method;

      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          status: "",
        },
      };

      if (classMethod === "approve") {
        updatedDoc.$set.status = "approved";
        updatedDoc.$unset = { feedback: "" };
      } else if (classMethod === "deny") {
        updatedDoc.$set.status = "denied";
        updatedDoc.$set.feedback = body.feedback || "";
      } else {
        return res.status(400).json("Invalid action");
      }

      const result = await classCollection.updateOne(filter, updatedDoc);
      res.json(result);
    });

    // ------------Instructor Methods------------
    // Check Instructor
    app.get("/users/instructor/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.json({ instructor: false });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      const result = { instructor: user?.role === "instructor" };
      res.json(result);
    });
    // send classes
    app.get(
      "/instructor/classes/:email",
      verifyJWT,
      verifyInstructor,
      async (req, res) => {
        const email = req.params.email;
        const result = await classCollection.find({ email: email }).toArray();
        res.json(result);
      }
    );
    // Add new class
    app.post("/addclass", verifyJWT, verifyInstructor, async (req, res) => {
      const item = req.body;
      item.createdAt = new Date();
      const result = await classCollection.insertOne(item);
      res.json(result);
    });

    // ------------Unauthorized Student Methods-------------
    // Popular Classes
    app.get("/popularClasses", async (req, res) => {
      const result = await classCollection
        .find({ status: "approved" })
        .sort({ enrolled: -1 })
        .limit(6)
        .project({
          _id: 1,
          name: 1,
          image: 1,
          seats: 1,
          price: 1,
          enrolled: 1,
          instructor: 1,
        })
        .toArray();

      res.json(result);
    });
    // Popular Instructors
    app.get("/popularInstructors", async (req, res) => {
      try {
        const result = await classCollection
          .aggregate([
            {
              $match: {
                status: "approved",
              },
            },
            {
              $group: {
                _id: "$instructor",
                name: { $first: "$instructor" },
                email: { $first: "$email" },
                totalStudents: { $sum: "$enrolled" },
                totalClasses: { $sum: 1 },
              },
            },
            { $sort: { totalStudents: -1 } },
            { $limit: 6 },
          ])
          .toArray();

        const instructorsWithEmail = result.filter(
          (instructor) => instructor.email
        ); // Filter out instructors without an email

        // Retrieve the instructor images from the userCollection
        const instructorsWithImage = await userCollection
          .aggregate([
            {
              $match: {
                email: {
                  $in: instructorsWithEmail.map(
                    (instructor) => instructor.email
                  ),
                },
              },
            },
            {
              $project: {
                _id: 0,
                email: 1,
                image: 1,
              },
            },
          ])
          .toArray();

        // Merge the instructor images into the result
        const resultWithImage = instructorsWithEmail.map((instructor) => {
          const { email } = instructor;
          const matchingInstructor = instructorsWithImage.find(
            (instructor) => instructor.email === email
          );
          return {
            ...instructor,
            image: matchingInstructor ? matchingInstructor.image : null,
          };
        });

        res.json(resultWithImage);
      } catch (error) {
        res.status(500).json("Internal Server Error");
      }
    });

    // All Instructors
    app.get("/instructors", async (req, res) => {
      try {
        const result = await userCollection
          .aggregate([
            {
              $match: { role: "instructor" },
            },
            {
              $lookup: {
                from: "classes",
                let: { instructorEmail: "$email" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ["$email", "$$instructorEmail"] },
                          { $eq: ["$status", "approved"] },
                        ],
                      },
                    },
                  },
                ],
                as: "approvedClasses",
              },
            },
            {
              $project: {
                _id: 1,
                name: 1,
                email: 1,
                image: 1,
                totalClasses: { $size: "$approvedClasses" },
              },
            },
          ])
          .toArray();
        res.json(result);
      } catch (error) {
        res.status(500).json("Internal Server Error");
      }
    });

    // Send Approved classes
    app.get("/classes", async (req, res) => {
      const result = await classCollection
        .find({ status: "approved" })
        .toArray();
      res.json(result);
    });

    // ------------Authorized Student Methods------------
    // Select Class
    app.patch("/classSelect/:id", verifyJWT, async (req, res) => {
      const studentEmail = req.body.email;
      const classId = req.params.id;

      try {
        const user = await userCollection.findOne({ email: studentEmail });

        if (!user || user.role !== "student") {
          return res.status(401).json("Unauthorized");
        }

        const query = { email: studentEmail };
        const update = { $addToSet: { selectedClass: classId } };
        const options = { upsert: true };

        const result = await userCollection.updateOne(query, update, options);
        res.json(result);
      } catch (error) {
        console.error("Error selecting class:", error);
        res.status(500).json("Internal Server Error");
      }
    });
    // Get Selected Classes
    app.get("/selectedClasses/:email", verifyJWT, async (req, res) => {
      const studentEmail = req.params.email;

      try {
        const user = await userCollection.findOne({ email: studentEmail });

        if (!user || user.role !== "student") {
          return res.status(404).json("Student not found");
        }

        const selectedClassIds = user.selectedClass || [];
        const objectIdClassIds = selectedClassIds.map((id) => new ObjectId(id));

        const classDetails = await classCollection
          .find({ _id: { $in: objectIdClassIds }, status: "approved" })
          .toArray();

        res.json(classDetails);
      } catch (error) {
        console.error("Error getting selected classes:", error);
        res.status(500).json("Internal Server Error");
      }
    });
    // Get Enrolled Class
    app.get("/enrolledClasses/:email", verifyJWT, async (req, res) => {
      const studentEmail = req.params.email;

      try {
        const user = await userCollection.findOne({ email: studentEmail });

        if (!user || user.role !== "student") {
          return res.status(404).json("Student not found");
        }

        const enrolledClassIds = user.enrolledClass || [];
        const objectIdClassIds = enrolledClassIds.map((id) => new ObjectId(id));

        const classDetails = await classCollection
          .find({ _id: { $in: objectIdClassIds }, status: "approved" })
          .toArray();

        // Fetch the enrolled time from the payment collection based on the email
        const enrolledTime = await paymentCollection
          .findOne({ email: studentEmail })
          .then((paymentInfo) => paymentInfo.createdAt);

        // Update the class details with the enrolled time
        const updatedClassDetails = classDetails.map((classDetail) => ({
          ...classDetail,
          enrolledTime: enrolledTime,
        }));

        res.json(updatedClassDetails);
      } catch (error) {
        console.error("Error getting selected classes:", error);
        res.status(500).json("Internal Server Error");
      }
    });
    // Get payment history
    app.get("/payments/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;

      try {
        // Find payment data for the specified email and sort by createdAt in descending order
        const payments = await paymentCollection
          .find({ email })
          .sort({ createdAt: -1 })
          .toArray();

        res.json(payments);
      } catch (error) {
        console.error("Error retrieving payment data:", error);
        res.status(500).json("Internal Server Error");
      }
    });
    // send instructor classes
    app.get("/instructor/:email", verifyJWT, async (req, res) => {
      try {
        const email = req.params.email;

        const classes = await classCollection
          .find({ email: email, status: "approved" })
          .toArray();
        res.json(classes);
      } catch (error) {
        console.error("Error fetching instructor classes:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // Start the server
    app.listen(3000, () => {
      // console.log("Server listening on port 3000");
    });

    // Update payment information With calculation enrolled student and more
    app.post("/payment", verifyJWT, async (req, res) => {
      const paymentInfo = req.body;
      const { email, classId } = paymentInfo;

      try {
        // Check if the user exists and is a student
        const user = await userCollection.findOne({ email: email });
        if (!user || user.role !== "student") {
          return res.status(401).json("Unauthorized");
        }

        // Update the user's enrolledClass array by adding the class ID
        const query = { email: email };
        const update = { $addToSet: { enrolledClass: classId } };
        const options = { upsert: true };
        await userCollection.updateOne(query, update, options);

        // Remove the class ID from the selectedClass array
        await userCollection.updateOne(
          { email: email },
          { $pull: { selectedClass: classId } }
        );

        // Increase the "enrolled" field in the class document
        const classObjectId = new ObjectId(classId);
        await classCollection.updateOne(
          { _id: classObjectId },
          { $inc: { enrolled: 1 } }
        );

        // Fetch the class name based on classId
        const classInfo = await classCollection.findOne({ _id: classObjectId });
        if (!classInfo) {
          throw new Error("Class not found");
        }

        // Add the class name to the paymentInfo object
        paymentInfo.className = classInfo.name;

        // Store the paymentInfo in the paymentCollection
        const result = await paymentCollection.insertOne(paymentInfo);

        res.json("Payment information updated successfully");
      } catch (error) {
        console.error("Error storing payment data:", error);
        res.status(500).json("Internal Server Error");
      }
    });

    // Create Payment intent
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const { classId } = req.body;

      try {
        const classObject = await classCollection.findOne({
          _id: new ObjectId(classId),
        });
        if (!classObject) {
          return res
            .status(404)
            .json({ error: true, message: "Class not found" });
        }
        const amount = classObject.price * 100;

        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.json({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        console.error("Error creating payment intent:", error);
        res.status(500).json({ error: true, message: "Internal Server Error" });
      }
    });

    // Remove Selected Class
    app.delete("/removeClass/:id", async (req, res) => {
      const classId = req.params.id;
      const studentEmail = req.body.email;

      try {
        const user = await userCollection.findOne({ email: studentEmail });

        if (!user || user.role !== "student") {
          return res.status(404).json("Student not found");
        }

        // Remove the class ID from the selectedClass array
        const updatedSelectedClass = user.selectedClass.filter(
          (id) => id !== classId
        );

        // Update the user document with the updated selectedClass array
        await userCollection.updateOne(
          { email: studentEmail },
          { $set: { selectedClass: updatedSelectedClass } }
        );

        res.status(200).json("Class removed successfully");
      } catch (error) {
        console.error("Error removing class:", error);
        res.status(500).json("Internal Server Error");
      }
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
  }
}

run().catch(console.dir);
// ------------------------

app.get("/", (req, res) => {
  res.json("Art Quest is running..");
});

app.listen(port, () => {
  console.log(`Art Quest is running on port: ${port}`);
});
