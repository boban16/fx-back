# IG REST API JS Wrapper

## Installation

```bash
yarn install ig-rest-api
```

## Usage

### 1. Import library

```js
// ES6
import IG from "ig-rest-api";
// Common
const IG = require("ig-rest-api");
```

### 2. Create a new instance

```js
const ig = new IG(yourApiKey, isDemo);
```

### 3. Use

Using Promise

```js
ig.login(username, password)
  .then((res) => {
    console.log(res);
    //
    ig.get("positions").then((positions) => {
      console.log("positions:", positions);
    });
  })
  .catch(console.error);
```

Using Async

```js
try {
  await ig.login(username, password);
  const positions = await ig.get("positions");
  console.log("positions:", positions);
} catch (error) {
  console.error(error);
}
```
