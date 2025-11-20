async function main() {
  console.log("\n" + "=".repeat(50));
  console.log("🚀 DEPLOYING ALERTLOGGER CONTRACT");
  console.log("=".repeat(50) + "\n");
  
  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log("📍 Deploying from account:", deployer.address);
  
  // Check balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", ethers.formatEther(balance), "POL");
  
  if (balance === 0n) {
    console.error("\n❌ ERROR: Insufficient balance!");
    console.log("Get testnet POL from: https://faucet.polygon.technology/");
    process.exit(1);
  }
  
  console.log("\n⏳ Deploying contract...");
  
  // Deploy contract
  const AlertLogger = await ethers.getContractFactory("AlertLogger");
  const contract = await AlertLogger.deploy();
  
  await contract.waitForDeployment();
  
  const address = await contract.getAddress();
  
  console.log("\n" + "=".repeat(50));
  console.log("✅ CONTRACT DEPLOYED SUCCESSFULLY!");
  console.log("=".repeat(50));
  console.log("\n📍 Contract Address:", address);
  console.log("\n📝 UPDATE YOUR .env FILE:");
  console.log(`CONTRACT_ADDRESS=${address}`);
  console.log("\n🔍 View on PolygonScan:");
  console.log(`https://amoy.polygonscan.com/address/${address}`);
  console.log("\n" + "=".repeat(50) + "\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ DEPLOYMENT FAILED:");
    console.error(error);
    process.exit(1);
  });