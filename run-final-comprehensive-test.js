const { spawn } = require('child_process');
const { ComprehensiveBackendTester } = require('./test-complete-backend-system');
const { AdvancedAPITester } = require('./test-advanced-api-routing');
const fs = require('fs');
const path = require('path');

/**
 * Final Comprehensive Test Runner
 * 
 * This script orchestrates the complete testing of the SAMM system:
 * 1. Starts all backend services
 * 2. Runs infrastructure tests
 * 3. Runs API tests
 * 4. Generates final deployment report
 * 5. Cleans up processes
 */

class FinalTestRunner {
  constructor() {
    this.processes = [];
    this.services = [
      {
        name: 'Multi-Chain Backend',
        command: 'node',
        args: ['services/src/multi-chain/main.ts'],
        cwd: 'samm-evm',
        port: 3000,
        healthEndpoint: 'http://localhost:3000/health'
      },
      {
        name: 'Router Service',
        command: 'node',
        args: ['services/src/router/index.ts'],
        cwd: 'samm-evm',
        port: 3001,
        healthEndpoint: 'http://localhost:3001/health'
      },
      {
        name: 'Liquidity Router',
        command: 'node',
        args: ['services/src/liquidity-router/index.ts'],
        cwd: 'samm-evm',
        port: 3002,
        healthEndpoint: 'http://localhost:3002/health'
      },
      {
        name: 'Cross-Pool Router',
        command: 'node',
        args: ['services/src/cross-pool-router/index.ts'],
        cwd: 'samm-evm',
        port: 3003,
        healthEndpoint: 'http://localhost:3003/health'
      }
    ];
    
    this.testResults = {
      infrastructure: null,
      api: null,
      overall: {
        totalTests: 0,
        passed: 0,
        failed: 0,
        successRate: 0
      }
    };
  }

  async startServices() {
    console.log("🚀 Starting Backend Services...");
    console.log("=".repeat(50));
    
    for (const service of this.services) {
      console.log(`Starting ${service.name}...`);
      
      const process = spawn(service.command, service.args, {
        cwd: service.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PORT: service.port }
      });
      
      process.stdout.on('data', (data) => {
        console.log(`[${service.name}] ${data.toString().trim()}`);
      });
      
      process.stderr.on('data', (data) => {
        console.error(`[${service.name}] ERROR: ${data.toString().trim()}`);
      });
      
      process.on('close', (code) => {
        console.log(`[${service.name}] Process exited with code ${code}`);
      });
      
      this.processes.push({ name: service.name, process, port: service.port });
      
      // Wait a bit between service starts
      await this.sleep(2000);
    }
    
    console.log("⏳ Waiting for services to initialize...");
    await this.sleep(10000); // Wait 10 seconds for all services to start
    
    // Check service health
    await this.checkServiceHealth();
  }

  async checkServiceHealth() {
    console.log("\n🏥 Checking Service Health...");
    
    const axios = require('axios');
    
    for (const service of this.services) {
      try {
        const response = await axios.get(service.healthEndpoint, { timeout: 5000 });
        console.log(`  ✅ ${service.name}: Healthy (${response.status})`);
      } catch (error) {
        console.log(`  ❌ ${service.name}: Unhealthy (${error.code || error.message})`);
      }
    }
  }

  async runInfrastructureTests() {
    console.log("\n🧪 Running Infrastructure Tests...");
    console.log("=".repeat(40));
    
    const tester = new ComprehensiveBackendTester();
    this.testResults.infrastructure = await tester.runAllTests();
    
    return this.testResults.infrastructure;
  }

  async runAPITests() {
    console.log("\n🌐 Running API Tests...");
    console.log("=".repeat(30));
    
    const tester = new AdvancedAPITester();
    this.testResults.api = await tester.runAllTests();
    
    return this.testResults.api;
  }

  async generateFinalReport() {
    console.log("\n📊 Generating Final Deployment Report...");
    
    // Calculate overall statistics
    const infraStats = this.testResults.infrastructure || { totalTests: 0, passed: 0, failed: 0 };
    const apiStats = this.testResults.api || { totalTests: 0, passed: 0, failed: 0 };
    
    this.testResults.overall = {
      totalTests: infraStats.totalTests + apiStats.totalTests,
      passed: infraStats.passed + apiStats.passed,
      failed: infraStats.failed + apiStats.failed
    };
    
    this.testResults.overall.successRate = 
      (this.testResults.overall.passed / this.testResults.overall.totalTests) * 100;
    
    // Load deployment information
    const deploymentInfo = this.loadDeploymentInfo();
    
    const finalReport = {
      timestamp: new Date().toISOString(),
      testSummary: this.testResults.overall,
      deploymentInfo,
      infrastructureTests: {
        summary: {
          totalTests: infraStats.totalTests,
          passed: infraStats.passed,
          failed: infraStats.failed,
          successRate: (infraStats.passed / infraStats.totalTests) * 100
        },
        details: this.testResults.infrastructure?.details || {}
      },
      apiTests: {
        summary: {
          totalTests: apiStats.totalTests,
          passed: apiStats.passed,
          failed: apiStats.failed,
          successRate: (apiStats.passed / apiStats.totalTests) * 100
        },
        details: this.testResults.api?.details || {}
      },
      readinessAssessment: {
        infrastructureReady: infraStats.failed === 0,
        apiReady: apiStats.failed === 0,
        overallReady: this.testResults.overall.failed === 0,
        deploymentRecommendation: this.testResults.overall.failed === 0 ? 
          "READY FOR PRODUCTION DEPLOYMENT" : 
          "REQUIRES FIXES BEFORE DEPLOYMENT"
      }
    };
    
    // Save final report
    const reportPath = path.join(__dirname, `FINAL-DEPLOYMENT-REPORT-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(finalReport, null, 2));
    
    // Generate markdown summary
    const markdownReport = this.generateMarkdownReport(finalReport);
    const markdownPath = path.join(__dirname, `FINAL-DEPLOYMENT-REPORT-${Date.now()}.md`);
    fs.writeFileSync(markdownPath, markdownReport);
    
    console.log("\n" + "=".repeat(70));
    console.log("🎯 FINAL DEPLOYMENT READINESS REPORT");
    console.log("=".repeat(70));
    
    console.log(`\n📊 Overall Test Results:`);
    console.log(`  Total Tests: ${this.testResults.overall.totalTests}`);
    console.log(`  Passed: ${this.testResults.overall.passed} ✅`);
    console.log(`  Failed: ${this.testResults.overall.failed} ❌`);
    console.log(`  Success Rate: ${this.testResults.overall.successRate.toFixed(1)}%`);
    
    console.log(`\n🏗️  Infrastructure Tests: ${infraStats.passed}/${infraStats.totalTests} passed`);
    console.log(`🌐 API Tests: ${apiStats.passed}/${apiStats.totalTests} passed`);
    
    console.log(`\n🚀 Deployment Status:`);
    if (finalReport.readinessAssessment.overallReady) {
      console.log(`  ✅ ${finalReport.readinessAssessment.deploymentRecommendation}`);
      console.log(`  🎉 All systems operational and ready for production!`);
    } else {
      console.log(`  ⚠️  ${finalReport.readinessAssessment.deploymentRecommendation}`);
      console.log(`  🔧 Please address failing tests before deployment`);
    }
    
    console.log(`\n📄 Reports saved:`);
    console.log(`  JSON: ${reportPath}`);
    console.log(`  Markdown: ${markdownPath}`);
    
    return finalReport;
  }

  loadDeploymentInfo() {
    const deploymentDir = path.join(__dirname, 'deployment-data');
    const files = fs.readdirSync(deploymentDir);
    
    const riseChainFile = files.find(f => f.includes('risechain') && f.endsWith('.json'));
    const monadFile = files.find(f => f.includes('monad') && f.endsWith('.json'));
    
    const deploymentInfo = {
      chains: [],
      totalLiquidity: 0,
      totalShards: 0
    };
    
    if (riseChainFile) {
      const riseData = JSON.parse(fs.readFileSync(path.join(deploymentDir, riseChainFile), 'utf8'));
      deploymentInfo.chains.push({
        name: 'RiseChain Testnet',
        chainId: riseData.chainId,
        shards: riseData.contracts?.shards?.length || 0,
        factory: riseData.contracts?.factory
      });
      deploymentInfo.totalShards += riseData.contracts?.shards?.length || 0;
    }
    
    if (monadFile) {
      const monadData = JSON.parse(fs.readFileSync(path.join(deploymentDir, monadFile), 'utf8'));
      deploymentInfo.chains.push({
        name: 'Monad Testnet',
        chainId: monadData.chainId,
        shards: monadData.contracts?.shards?.length || 0,
        factory: monadData.contracts?.factory
      });
      deploymentInfo.totalShards += monadData.contracts?.shards?.length || 0;
    }
    
    return deploymentInfo;
  }

  generateMarkdownReport(report) {
    return `# SAMM Final Deployment Report

**Generated:** ${report.timestamp}

## 🎯 Executive Summary

${report.readinessAssessment.overallReady ? '✅' : '⚠️'} **${report.readinessAssessment.deploymentRecommendation}**

- **Total Tests:** ${report.testSummary.totalTests}
- **Success Rate:** ${report.testSummary.successRate.toFixed(1)}%
- **Infrastructure Ready:** ${report.readinessAssessment.infrastructureReady ? '✅' : '❌'}
- **API Ready:** ${report.readinessAssessment.apiReady ? '✅' : '❌'}

## 🏗️ Deployment Information

### Multi-Chain Deployment
${report.deploymentInfo.chains.map(chain => 
  `- **${chain.name}** (Chain ID: ${chain.chainId})
  - Shards: ${chain.shards}
  - Factory: \`${chain.factory}\``
).join('\n')}

**Total Shards Deployed:** ${report.deploymentInfo.totalShards}

## 📊 Test Results

### Infrastructure Tests
- **Passed:** ${report.infrastructureTests.summary.passed}/${report.infrastructureTests.summary.totalTests}
- **Success Rate:** ${report.infrastructureTests.summary.successRate.toFixed(1)}%

### API Tests  
- **Passed:** ${report.apiTests.summary.passed}/${report.apiTests.summary.totalTests}
- **Success Rate:** ${report.apiTests.summary.successRate.toFixed(1)}%

## 🚀 Next Steps

${report.readinessAssessment.overallReady ? 
  `The SAMM system has passed all tests and is ready for production deployment. All infrastructure components, APIs, and multi-chain functionality are operational.` :
  `Please address the failing tests before proceeding with production deployment. Review the detailed test results for specific issues that need resolution.`
}

---
*Report generated by SAMM Final Test Runner*
`;
  }

  async cleanup() {
    console.log("\n🧹 Cleaning up processes...");
    
    for (const { name, process } of this.processes) {
      console.log(`Stopping ${name}...`);
      process.kill('SIGTERM');
    }
    
    // Wait for processes to terminate
    await this.sleep(3000);
    
    console.log("✅ Cleanup complete");
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async run() {
    try {
      console.log("🎯 SAMM Final Comprehensive Test Suite");
      console.log("=====================================");
      console.log("This will test the complete SAMM system end-to-end");
      console.log("");
      
      // Start all backend services
      await this.startServices();
      
      // Run infrastructure tests
      await this.runInfrastructureTests();
      
      // Run API tests
      await this.runAPITests();
      
      // Generate final report
      const finalReport = await this.generateFinalReport();
      
      // Cleanup
      await this.cleanup();
      
      // Exit with appropriate code
      process.exit(finalReport.readinessAssessment.overallReady ? 0 : 1);
      
    } catch (error) {
      console.error("❌ Final test suite failed:", error);
      await this.cleanup();
      process.exit(1);
    }
  }
}

// Main execution
if (require.main === module) {
  const runner = new FinalTestRunner();
  runner.run();
}

module.exports = { FinalTestRunner };