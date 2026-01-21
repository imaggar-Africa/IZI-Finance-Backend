const axios = require("axios");

const apiUser = "71501391-a1b3-446a-a147-d57a59b5ebfd";
const apiKey  = "9e87661e335f4b90beba36c94a895591";
const subKey  = "659ff4c315b845caa6fba7952bc3b9a3";

const auth = Buffer.from(`${apiUser}:${apiKey}`).toString("base64");

axios.post(
  "https://sandbox.momodeveloper.mtn.com/disbursement/oauth2/token",
  "grant_type=client_credentials",
  {
    headers: {
      Authorization: `Basic ${auth}`,
      "Ocp-Apim-Subscription-Key": subKey,
      "X-Target-Environment": "sandbox",
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    }
  }
)
.then(res => {
  console.log("SUCCESS ✅");
  console.log(res.data);
})
.catch(err => {
  console.error("FAILED ❌");
  if (err.response) {
    console.error(err.response.data);
  } else {
    console.error(err.message);
  }
});
