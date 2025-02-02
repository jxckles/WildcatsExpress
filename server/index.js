const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const UserModel = require("./models/User");
const MenuItem = require("./models/Menu");
const Order = require("./models/Order");
const History = require("./models/History.js");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const app = express();
const nodemailer = require("nodemailer");
const ClientOrder = require("./models/ClientOrder");
const QRCode = require("./models/QRCode.js");
const GCash = require('./models/GCash');


const http = require("http");
const socketIo = require("socket.io");

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log("New client connected");

  socket.on("authenticate", (userId) => {
    socket.userId = userId;
    console.log(`User ${userId} authenticated`);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);

app.use(
  "/UploadedReceipts",
  express.static(path.join(__dirname, "public/UploadedReceipts"))
);

// Static folder for images
app.use("/Images", express.static(path.join(__dirname, "public/Images")));

mongoose.connect(
  "mongodb+srv://castroy092003:7xiHqTSiUKH0ZIf4@wildcats-food-express.7w2snhk.mongodb.net/User?retryWrites=true&w=majority&appName=Wildcats-Food-Express"
);

// Multer configuration for receipt upload
const receiptStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "public/UploadedReceipts");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      `receipt-proof-of-payment-${uniqueSuffix}${path.extname(
        file.originalname
      )}`
    );
  },
});

const uploadReceipt = multer({ storage: receiptStorage });

// Multer setup for image storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "public/Images");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

app.post("/Login", (req, res) => {
  const { email, password } = req.body;
  UserModel.findOne({ email: email })
    .then((user) => {
      if (user) {
        // Directly compare passwords (not recommended)
        if (password === user.password) {
          const role = user.role;
          const userID = user._id;
          const userName = user.firstName + " " + user.lastName;
          const accessToken = jwt.sign(
            { email: email, role: role },
            "jwt-access-token-secret-key",
            { expiresIn: "7d" } // Access token valid for 2 days
          );
          const refreshToken = jwt.sign(
            { email: email, role: role },
            "jwt-refresh-access-token-secret-key",
            { expiresIn: "7d" } // Refresh token valid for 2 days
          );
          res.cookie("accessToken", accessToken, { maxAge: 15 * 60 * 1000 }); // 15 minutes
          res.cookie("refreshToken", refreshToken, {
            maxAge: 2 * 24 * 60 * 60 * 1000, // 2 days
            httpOnly: true,
            secure: true,
            sameSite: "strict",
          });
          return res.json({ role, userID, userName });
        } else {
          return res.json("Incorrect password");
        }
      } else {
        return res.json("User does not exist");
      }
    })
    .catch((err) => {
      return res.status(500).json({ message: "Server error" });
    });
});

const verifyUser = (req, res, next) => {
  const accessToken = req.cookies.accessToken;
  if (!accessToken) {
    return res
      .status(401)
      .json({ valid: false, message: "Access token missing" });
  }

  jwt.verify(accessToken, "jwt-access-token-secret-key", (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .json({ valid: false, message: "Invalid access token" });
    }

    req.email = decoded.email;
    req.role = decoded.role;

    next();
  });
};

const renewToken = (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) {
    return res.json({ valid: false, message: "No Refresh Token" });
  } else {
    jwt.verify(
      refreshToken,
      "jwt-refresh-access-token-secret-key",
      (err, decoded) => {
        if (err) {
          return res.json({ valid: false, message: "Invalid Refresh Token" });
        } else {
          const accessToken = jwt.sign(
            { email: decoded.email, role: decoded.role },
            "jwt-access-token-secret-key",
            { expiresIn: "1m" }
          );
          res.cookie("accessToken", accessToken, { maxAge: 60000 });
          req.email = decoded.email;
          req.role = decoded.role;
          return true;
        }
      }
    );
  }
};

app.get("/admin", verifyUser, (req, res) => {
  if (req.role !== "Admin") {
    return res
      .status(403)
      .json({ valid: false, message: "Forbidden: Admins only" });
  }
  return res.json({ valid: true, message: "Welcome Admin", role: req.role });
});

app.get("/dashboard", verifyUser, (req, res) => {
  if (req.role !== "User") {
    return res
      .status(403)
      .json({ valid: false, message: "Forbidden: Users only" });
  }
  return res.json({ valid: true, message: "Welcome User", role: req.role });
});

app.get("/client-interface", verifyUser, (req, res) => {
  if (req.role !== "Admin") {
    return res
      .status(403)
      .json({ valid: false, message: "Forbidden: Admins only" });
  }
  return res.json({ valid: true, message: "Welcome Admin", role: req.role });
});

app.post("/logout", (req, res) => {
  res.clearCookie("accessToken", { path: "/" });
  res.clearCookie("refreshToken", { path: "/" });
  return res.json({ message: "Logged out successfully" });
});

app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  try {
    const user = await UserModel.findOne({ email });
    if (!user) {
      return res.json({ message: "User not registered" });
    }

    const token = jwt.sign({ id: user._id }, "jwt-access-token-secret-key", {
      expiresIn: "5m",
    });

    var transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "wildcatfoodexpress@gmail.com",
        pass: "rofq crlc rvam atah",
      },
    });

    var mailOptions = {
      from: "wildcatfoodexpress@gmail.com",
      to: email,
      subject: "Reset Password",
      text: `http://localhost:5173/reset-password/${token}`,
    };

    transporter.sendMail(mailOptions, function (error, info) {
      if (error) {
        return res.json({ message: "Error sending email" });
      } else {
        return res.json({ status: true, message: "Email sent" });
      }
    });
  } catch (err) {
    console.log(err);
  }
});

app.post("/reset-password/:token", async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  try {
    const decoded = jwt.verify(token, "jwt-access-token-secret-key");
    const user = await UserModel.findById(decoded.id);
    if (!user) {
      return res
        .status(400)
        .json({ message: "Invalid token or user does not exist" });
    }
    user.password = password;
    await user.save();
    res.json({ status: true, message: "Password reset successfully" });
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: "Invalid or expired token" });
  }
});

app.post("/Register", (req, res) => {
  const { email } = req.body;
  UserModel.findOne({ email: email }).then((existingUser) => {
    if (existingUser) {
      res.json("Email already exists");
    } else {
      // Since profile picture is added later, it's initially set to null
      UserModel.create({ ...req.body, profilePicture: null })
        .then((User) => res.json(User))
        .catch((err) => res.status(400).json(err));
    }
  });
});

// Menu item route
app.get("/menu", async (req, res) => {
  try {
    const items = await MenuItem.find();
    res.json(items);
  } catch (err) {
    res.status(400).json(err);
  }
});

// Modified to handle image upload
app.post("/menu", upload.single("image"), async (req, res) => {
  try {
    const item = new MenuItem({
      ...req.body,
      image: req.file.path, // Save the path of the uploaded image
    });
    const savedItem = await item.save();
    res.json(savedItem);
  } catch (err) {
    res.status(400).json(err);
  }
});

app.put("/menu/:id", upload.single("image"), async (req, res) => {
  try {
    const updateData = { ...req.body };
    if (req.file) {
      updateData.image = req.file.path; // Update image path if a new image is uploaded
    }
    const item = await MenuItem.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
    });
    res.json(item);
  } catch (err) {
    res.status(400).json(err);
  }
});

app.delete("/menu/:id", async (req, res) => {
  try {
    const item = await MenuItem.findByIdAndDelete(req.params.id);
    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }

    // Delete the image file if it exists
    if (item.image) {
      fs.unlink(item.image, (err) => {
        if (err) {
          console.error("Error deleting image file:", err);
        } else {
          console.log("Image file deleted successfully");
        }
      });
    }

    res.json({ message: "Item deleted" });
  } catch (err) {
    console.error("Error deleting menu item:", err);
    res.status(400).json(err);
  }
});

app.get("/menu/:id/quantity", async (req, res) => {
  try {
    const item = await MenuItem.findById(req.params.id);
    if (!item) {
      return res.status(404).send({ message: "Item not found" });
    }
    res.send({ quantity: item.quantity });
  } catch (error) {
    res.status(500).send({ message: "Error fetching item quantity", error });
  }
});

//for placing orders
app.post("/orders", async (req, res) => {
  const { userId, userName, menusOrdered, studentNumber, status, totalPrice } =
    req.body;

  console.log("Received Order Payload:", JSON.stringify(req.body, null, 2));

  if (
    !userId ||
    !Array.isArray(menusOrdered) ||
    !studentNumber ||
    !totalPrice
  ) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Create a new order with receiptPath, referenceNumber, and amountSent as null
    const newOrder = new Order({
      userId,
      userName,
      menusOrdered,
      studentNumber,
      status,
      totalPrice,
      receiptPath: null, // Explicitly setting the default value
      referenceNumber: null, // Explicitly setting the default value
      amountSent: null, // Explicitly setting the default value
    });

    await newOrder.save({ session });

    // Update the quantities of the ordered menu items
    for (const orderedMenu of menusOrdered) {
      // Find the menu item
      const menuItem = await MenuItem.findOne({
        name: orderedMenu.itemName,
      }).session(session);
      if (!menuItem) {
        throw new Error(
          `Menu item with name ${orderedMenu.itemName} not found`
        );
      }
      if (menuItem.quantity < orderedMenu.quantity) {
        throw new Error(`Not enough quantity for menu item: ${menuItem.name}`);
      }
      menuItem.quantity -= orderedMenu.quantity;
      await menuItem.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    // After successfully creating the order
    io.emit("newOrder", newOrder);

    res
      .status(201)
      .json({ message: "Order placed successfully", order: newOrder });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error placing order:", error.message);
    res.status(500).json({
      message: `Failed to place order. Please try again. ${error.message}`,
    });
  }
});

app.get("/orders", async (req, res) => {
  try {
    const userId = req.query.userId;
    let orders;
    //check if the user is the admin
    if (userId === "668e8d77cfc185e3ac2d32a5") {
      orders = await Order.find({});
    } else {
      orders = await Order.find({ userId: userId });
    }
    res.json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ message: "Failed to fetch orders" });
  }
});

//for client order interface; handle place order

app.post("/clientorders", async (req, res) => {
  try {
    const { schoolId, items, status, priorityNumber, totalPrice } = req.body;

    if (!schoolId || !items || !status || totalPrice === undefined) {
      // Check for totalPrice
      return res.status(400).json({ message: "Missing required fields" });
    }

    const newOrder = new ClientOrder({
      schoolId,
      items,
      status,
      priorityNumber: priorityNumber || Math.floor(Math.random() * 1000000), // Generate if not provided
      totalPrice, // Include totalPrice in the new order
    });

    await newOrder.validate(); // Validate schema before saving
    await newOrder.save();
    res
      .status(201)
      .json({ message: "Order placed successfully", order: newOrder });
  } catch (error) {
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({ message: "Validation error", errors });
    }
    console.error("Error placing order:", error);
    res
      .status(500)
      .json({ message: "Failed to place order", error: error.message });
  }
});

app.post("/update-quantity", async (req, res) => {
  const { itemId, quantityChange } = req.body;

  try {
    const item = await MenuItem.findById(itemId);
    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }

    item.quantity += quantityChange;
    await item.save();

    res.json({ message: "Quantity updated", item });
  } catch (error) {
    console.error("Error updating quantity:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

app.get("/clientorders", async (req, res) => {
  try {
    const orders = await ClientOrder.find();
    res.status(200).json(orders);
  } catch (error) {
    console.error("Error fetching client orders:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch client orders", error: error.message });
  }
});

app.put("/clientorders/:orderId/status", async (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;

  try {
    const order = await ClientOrder.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    order.status = status;
    await order.save();

    res.status(200).json(order);
  } catch (error) {
    console.error("Error updating order status:", error);
    res
      .status(500)
      .json({ message: "Failed to update order status", error: error.message });
  }
});

app.delete("/clientorders/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    const order = await ClientOrder.findByIdAndDelete(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.status(200).json({ message: "Order deleted successfully" });
  } catch (error) {
    console.error("Error deleting order:", error);
    res
      .status(500)
      .json({ message: "Failed to delete order", error: error.message });
  }
});

//for change password

app.post("/change-password", async (req, res) => {
  const { userId, oldPassword, newPassword } = req.body;

  try {
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).send("User not found.");
    }

    if (user.password !== oldPassword) {
      return res.status(400).send("Old password is incorrect.");
    }

    user.password = newPassword;
    await user.save();

    res.send("Password successfully changed.");
  } catch (error) {
    console.error(error);
    res.status(500).send("An error occurred.");
  }
});

//history of orders
async function getHistoryOrdersByUserId(userId) {
  try {
    let query = {};
    //check if admin
    if (userId !== "668e8d77cfc185e3ac2d32a5") {
      query.userId = userId;
    }
    const orders = await History.find(query);
    return orders;
  } catch (error) {
    console.error("Error fetching orders from database:", error);
    throw error;
  }
}

app.get("/history-orders", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).send("UserID is required");
    }
    const orders = await getHistoryOrdersByUserId(userId);
    res.json(orders);
  } catch (error) {
    console.error("Error fetching history orders:", error);
    res.status(500).send("Internal Server Error");
  }
});

//get user data
app.get("/user/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const user = await UserModel.findById(userId).exec();
    if (user) {
      res.json({
        firstName: user.firstName,
        lastName: user.lastName,
        courseYear: user.courseYear,
        profilePicture: user.profilePicture,
      });
    } else {
      res.status(404).send("User not found");
    }
  } catch (error) {
    console.error("Error fetching user data:", error);
    res.status(500).send("Internal Server Error");
  }
});

//updating user data
app.put(
  "/update-profile/:userId",
  upload.single("profilePicture"),
  async (req, res) => {
    try {
      const userId = req.params.userId;
      const { firstName, lastName, courseYear } = req.body;
      const updateData = {
        firstName,
        lastName,
        courseYear,
      };

      if (req.file) {
        updateData.profilePicture = `/Images/${req.file.filename}`;
      }

      const updatedUser = await UserModel.findByIdAndUpdate(
        userId,
        updateData,
        { new: true }
      );
      if (updatedUser) {
        res.json({
          message: "Profile updated successfully!",
          user: updatedUser,
        });
      } else {
        res.status(404).send("User not found");
      }
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).send("Internal Server Error");
    }
  }
);

//order status
app.put("/orders/:orderId/status", async (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;

  try {
    const order = await Order.findOneAndUpdate(
      { _id: orderId },
      { status },
      { new: true }
    );

    if (!order) {
      return res.status(404).send({ message: "Order not found" });
    }

    // Emit the status update to all connected clients
    io.emit("orderStatusUpdate", {
      _id: order._id,
      studentNumber: order.studentNumber,
      status: order.status,
      userId: order.userId,
    });

    //check if status compelete delete from order and move to history
    if (status === "Completed" || status === "Cancelled") {
      const historyOrder = new History(order.toObject());
      await historyOrder.save();
      await Order.deleteOne({ _id: orderId });

      return res
        .status(200)
        .send({ message: "Order completed and moved to history" });
    }

    res.status(200).send(order);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Error updating order status" });
  }
});

// Change app.listen to server.listen
server.listen(5000, () => {
  console.log("Server is running on port 5000");
});

// QR Code upload route
app.post("/upload-qr-code", upload.single("qrCode"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const qrCodeUrl = `/Images/${req.file.filename}`;

    // Remove existing QR code if any
    await QRCode.deleteMany({});

    // Create new QR code entry
    const newQRCode = new QRCode({ imageUrl: qrCodeUrl });
    await newQRCode.save();

    res
      .status(200)
      .json({ message: "QR code uploaded successfully", qrCodeUrl });
  } catch (error) {
    console.error("Error uploading QR code:", error);
    res.status(500).json({ message: "Failed to upload QR code" });
  }
});

// QR Code removal route
app.delete("/remove-qr-code", async (req, res) => {
  try {
    const qrCode = await QRCode.findOne();
    if (qrCode) {
      // Remove the image file
      const imagePath = path.join(__dirname, "public", qrCode.imageUrl);
      fs.unlink(imagePath, (err) => {
        if (err) console.error("Error deleting QR code image:", err);
      });

      // Remove the database entry
      await QRCode.deleteMany({});
      res.status(200).json({ message: "QR code removed successfully" });
    } else {
      res.status(404).json({ message: "No QR code found" });
    }
  } catch (error) {
    console.error("Error removing QR code:", error);
    res.status(500).json({ message: "Failed to remove QR code" });
  }
});

// QR Code retrieval route
app.get("/get-qr-code", async (req, res) => {
  try {
    const qrCode = await QRCode.findOne();
    if (qrCode) {
      res.status(200).json({ qrCodeUrl: qrCode.imageUrl });
    } else {
      res.status(404).json({ message: "No QR code found" });
    }
  } catch (error) {
    console.error("Error retrieving QR code:", error);
    res.status(500).json({ message: "Failed to retrieve QR code" });
  }
});

// Route to handle receipt upload
app.put("/update-order", uploadReceipt.single("receipt"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const { orderId, referenceNumber, amountSent } = req.body;
  const receiptPath = `/UploadedReceipts/${req.file.filename}`;

  try {
    const order = await Order.findByIdAndUpdate(
      orderId,
      {
        receiptPath,
        referenceNumber,
        amountSent,
      },
      { new: true }
    );

    if (!order) {
      await fs.promises.unlink(path.join(__dirname, "public", receiptPath));
      return res.status(404).json({ message: "Order not found" });
    }

    res.status(200).json({ message: "Order updated successfully", order });
  } catch (error) {
    console.error("Error updating order:", error);
    if (req.file) {
      await fs.promises.unlink(path.join(__dirname, "public", receiptPath));
    }
    res.status(500).json({ message: "Failed to update order" });
  }
});

app.post("/update-gcash-number", async (req, res) => {
  try {
    const { gcashNumber } = req.body;
    let gcash = await GCash.findOne();
    if (!gcash) {
      gcash = new GCash({ number: gcashNumber });
    } else {
      gcash.number = gcashNumber;
    }
    await gcash.save();
    res.status(200).json({ success: true, message: "GCash number updated successfully" });
  } catch (error) {
    console.error("Error updating GCash number:", error);
    res.status(500).json({ success: false, message: "Failed to update GCash number" });
  }
});

app.get("/get-gcash-number", async (req, res) => {
  try {
    const gcash = await GCash.findOne();
    if (gcash) {
      res.status(200).json({ gcashNumber: gcash.number });
    } else {
      res.status(404).json({ message: "No GCash number found" });
    }
  } catch (error) {
    console.error("Error retrieving GCash number:", error);
    res.status(500).json({ message: "Failed to retrieve GCash number" });
  }
});