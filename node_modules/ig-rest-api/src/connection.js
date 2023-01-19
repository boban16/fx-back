const axios = require("axios").default;
const { path } = require("rambda");

const appToken = path("headers.x-security-token");
const clientToken = path("headers.cst");

exports.create = (apiKey, isDemo) => {
  return axios.create({
    baseURL: `https://${isDemo ? "demo-" : ""}api.ig.com/gateway/deal/`,
    headers: {
      Accept: "application/json; charset=UTF-8",
      "Content-Type": "application/json; charset=UTF-8",
      "X-IG-API-KEY": apiKey,
    },
  });
};

exports.setHeaderTokens = (instance, response) => {
  instance.defaults.headers["X-SECURITY-TOKEN"] = appToken(response);
  instance.defaults.headers["CST"] = clientToken(response);
};
