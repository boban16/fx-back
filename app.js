import cors from 'cors'
import express from 'express';
import api from './router/api';

const app = express();
app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/apiBack/', api)

app.get('/', (req, res) => {
  res.status(200).json({
    message: "Welcome to Express"
  });
})

app.listen(8000, () => console.log('Server running at 8000'));
