import { Account, Client, Databases } from "appwrite";

const client = new Client()
  .setEndpoint("https://nyc.cloud.appwrite.io/v1")
  .setProject("69a943e00002c056efc0");

const account = new Account(client);
const databases = new Databases(client);

export { client, account, databases };

