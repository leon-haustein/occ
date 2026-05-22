require('dotenv').config();
const express = require('express');
const cors = require('cors');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/api', apiRouter);

app.listen(PORT, () => {
    console.log(`Server running at http://127.0.0.1:${PORT}`);
});
