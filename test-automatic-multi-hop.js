#!/usr/bin/env node

/**
 * Test AUTOMATIC Multi-Hop Swaps via API
 * User just calls one endpoint, system does the routing automatically
 */

require('dotenv').config({ path: '.env.monad' });
const axios = require('axios');

async function testAutomaticMultiHop() {
  console.log('🤖 TESTING AUTOMATIC MULTI-HOP SWAPS');
  console.log('====================================');
  
  const API_BASE = 'http://localhost:3001';
  
  // Test 1: User wants to swap USDT for DAI
  // System automatically finds: USDT -> USDC -> DAI route
  console.log('\n🔀 Test 1: Automatic USDT -> DAI routing');
  
  try {
    const response = await axios.get(`${API_BASE}/api/route`, {
      params: {
        tokenIn: '0x1888FF2446f2542cbb399eD179F4d6d966268C1F',  // USDT
        tokenOut: '0x60CB213FCd1616FbBD44319Eb11A35d5671E692e', // DAI
        amountIn: '100000000', // 100 USDT (6 decimals)
        chain: 'monad'
      }
    });
    
    console.log('✅ API Response:');
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.route && response.data.route.length > 1) {
      console.log('\n🎉 AUTOMATIC MULTI-HOP ROUTING WORKS!');
      console.log(`📍 Route found: ${response.data.route.map(r => r.pool).join(' -> ')}`);
      console.log(`💰 Expected output: ${response.data.amountOut} DAI`);
    }
    
  } catch (error) {
    console.log('❌ API call failed:', error.message);
    console.log('💡 Make sure the backend is running: npm run start:monad');
  }
  
  // Test 2: User wants to swap DAI for USDT (reverse)
  console.log('\n🔄 Test 2: Automatic DAI -> USDT routing');
  
  try {
    const response = await axios.get(`${API_BASE}/api/route`, {
      params: {
        tokenIn: '0x60CB213FCd1616FbBD44319Eb11A35d5671E692e',  // DAI
        tokenOut: '0x1888FF2446f2542cbb399eD179F4d6d966268C1F', // USDT
        amountIn: '100000000000000000000', // 100 DAI (18 decimals)
        chain: 'monad'
      }
    });
    
    console.log('✅ Reverse Route Response:');
    console.log(JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.log('❌ Reverse API call failed:', error.message);
  }
  
  console.log('\n📋 HOW IT WORKS FOR USERS:');
  console.log('==========================');
  console.log('1. User calls: GET /api/route?tokenIn=USDT&tokenOut=DAI&amountIn=100');
  console.log('2. System automatically finds: USDT -> USDC -> DAI');
  console.log('3. System returns complete route with gas estimates');
  console.log('4. User executes with one transaction (or system does it)');
  console.log('');
  console.log('🎯 USER EXPERIENCE:');
  console.log('   - Input: "I want to swap 100 USDT for DAI"');
  console.log('   - Output: "You will get ~93.5 DAI" (automatic routing)');
  console.log('   - No manual multi-hop needed!');
}

testAutomaticMultiHop()
  .then(() => {
    console.log('\n🏁 Automatic multi-hop test complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });