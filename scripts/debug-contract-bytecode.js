require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ethers } = require("ethers");

// Create provider directly to avoid ENS issues
function createDirectProvider() {
  const rpcUrl = process.env.RISECHAIN_RPC_URL;
  const privateKey = process.env.PRIVATE_KEY;
  
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  
  return { provider, wallet };
}

async function debugContractBytecode() {
  console.log("🔍 Debugging Contract Bytecode");
  console.log("=".repeat(50));

  try {
    const { provider } = createDirectProvider();
    
    const addresses = {
      factory: "0x1888FF2446f2542cbb399eD179F4d6d966268C1F",
      tokenA: "0x60CB213FCd1616FbBD44319Eb11A35d5671E692e",
      tokenB: "0x3f256051aEd4bEc7947Bac441B0A5812601320063",
      shard1: "0xF4d727cFB4C6976833BCA7bfDB2e1554dcc5eD92",
      shard2: "0x9Fa78607d2602A014Edb84e8D612BA72F231DBE3",
      shard3: "0xf304b46da668a5E889E898157d609E95EdC8baa7",
      shard4: "0x8d58e82C5379af5222EBFb50b16a0f17e2181C37"
    };
    
    for (const [name, address] of Object.entries(addresses)) {
      console.log(`\n📋 Checking ${name}: ${address}`);
      
      // Get bytecode
      const code = await provider.getCode(address);
      console.log(`Bytecode length: ${code.length} characters`);
      console.log(`Has code: ${code !== "0x" ? "✅ YES" : "❌ NO"}`);
      
      if (code !== "0x") {
        console.log(`First 100 chars: ${code.substring(0, 100)}...`);
        
        // Try to get basic info using low-level calls
        try {
          // Try to call a simple view function using low-level call
          if (name.includes('token')) {
            // Try calling name() function - selector 0x06fdde03
            const nameCall = await provider.call({
              to: address,
              data: "0x06fdde03"
            });
            console.log(`name() call result: ${nameCall}`);
            
            // Try calling symbol() function - selector 0x95d89b41
            const symbolCall = await provider.call({
              to: address,
              data: "0x95d89b41"
            });
            console.log(`symbol() call result: ${symbolCall}`);
            
          } else if (name.includes('shard')) {
            // Try calling tokenA() function - selector 0x0dfe1681
            const tokenACall = await provider.call({
              to: address,
              data: "0x0dfe1681"
            });
            console.log(`tokenA() call result: ${tokenACall}`);
            
            // Try calling initialized() function - selector 0x158ef93e
            const initializedCall = await provider.call({
              to: address,
              data: "0x158ef93e"
            });
            console.log(`initialized() call result: ${initializedCall}`);
            
          } else if (name === 'factory') {
            // Try calling owner() function - selector 0x8da5cb5b
            const ownerCall = await provider.call({
              to: address,
              data: "0x8da5cb5b"
            });
            console.log(`owner() call result: ${ownerCall}`);
          }
          
        } catch (error) {
          console.log(`❌ Low-level call failed: ${error.message}`);
        }
      }
    }
    
    // Check if we can get transaction receipts for the deployments
    console.log("\n📋 Checking deployment transactions...");
    
    const deploymentTxs = [
      "0x086e16235eba82e9ce84665d963e778e55dd348bc325c872b06c0c90eb23780b", // Factory
      "0x5bd31b3eb3d9d8791646092968b9c320210aba96a809b717b28188ec4f69aaf4"  // Shard creation
    ];
    
    for (const txHash of deploymentTxs) {
      try {
        console.log(`\n🔍 Checking transaction: ${txHash}`);
        const receipt = await provider.getTransactionReceipt(txHash);
        
        if (receipt) {
          console.log(`Status: ${receipt.status === 1 ? "✅ SUCCESS" : "❌ FAILED"}`);
          console.log(`Gas used: ${receipt.gasUsed}`);
          console.log(`Contract address: ${receipt.contractAddress || "N/A"}`);
          console.log(`Logs count: ${receipt.logs.length}`);
          
          if (receipt.logs.length > 0) {
            console.log("Event logs found:");
            receipt.logs.forEach((log, i) => {
              console.log(`  Log ${i}: ${log.address} - ${log.topics[0]}`);
            });
          }
        } else {
          console.log("❌ Transaction not found");
        }
      } catch (error) {
        console.log(`❌ Error getting transaction: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error("❌ Debug failed:", error.message);
  }
}

debugContractBytecode()
  .then(() => {
    console.log("\n✅ Bytecode debug completed");
    process.exit(0);
  })
  .catch(error => {
    console.error("❌ Debug failed:", error.message);
    process.exit(1);
  });