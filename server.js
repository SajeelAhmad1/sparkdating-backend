const dotenv = require('dotenv');

dotenv.config();

const app = require('./app');

async function main() {
  const port = process.env.PORT || 5000;

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on port ${port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

