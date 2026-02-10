/**
 * Unit tests for initialize-empty-pools script utilities
 */

const { expect } = require("chai");
const {
  parseArgs,
  withErrorHandling,
  retryWithBackoff,
  getTimestamp,
  colors
} = require("../../scripts/initialize-empty-pools");

describe("Initialize Empty Pools - Core Utilities", function() {
  
  describe("CLI Argument Parsing", function() {
    
    it("should parse dry-run flag correctly", function() {
      // Mock process.argv
      const originalArgv = process.argv;
      
      // Test with --dry-run flag
      process.argv = ['node', 'script.js', '--dry-run'];
      const args1 = parseArgs();
      expect(args1.dryRun).to.be.true;
      
      // Test without --dry-run flag
      process.argv = ['node', 'script.js'];
      const args2 = parseArgs();
      expect(args2.dryRun).to.be.false;
      
      // Restore original argv
      process.argv = originalArgv;
    });
    
  });
  
  describe("Error Handling Wrapper", function() {
    
    it("should execute function successfully", async function() {
      const testFn = async (x) => x * 2;
      const wrapped = withErrorHandling(testFn, "test");
      
      const result = await wrapped(5);
      expect(result).to.equal(10);
    });
    
    it("should catch and re-throw errors with context", async function() {
      const testFn = async () => {
        throw new Error("Test error");
      };
      const wrapped = withErrorHandling(testFn, "test context");
      
      try {
        await wrapped();
        expect.fail("Should have thrown error");
      } catch (error) {
        expect(error.message).to.equal("Test error");
      }
    });
    
  });
  
  describe("Retry with Backoff", function() {
    
    it("should succeed on first attempt", async function() {
      let attempts = 0;
      const testFn = async () => {
        attempts++;
        return "success";
      };
      
      const result = await retryWithBackoff(testFn, 3, 10);
      expect(result).to.equal("success");
      expect(attempts).to.equal(1);
    });
    
    it("should retry on failure and eventually succeed", async function() {
      let attempts = 0;
      const testFn = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Temporary failure");
        }
        return "success";
      };
      
      const result = await retryWithBackoff(testFn, 3, 10);
      expect(result).to.equal("success");
      expect(attempts).to.equal(3);
    });
    
    it("should throw error after max retries", async function() {
      let attempts = 0;
      const testFn = async () => {
        attempts++;
        throw new Error("Permanent failure");
      };
      
      try {
        await retryWithBackoff(testFn, 3, 10);
        expect.fail("Should have thrown error");
      } catch (error) {
        expect(error.message).to.equal("Permanent failure");
        expect(attempts).to.equal(3);
      }
    });
    
  });
  
  describe("Timestamp Formatting", function() {
    
    it("should return formatted timestamp", function() {
      const timestamp = getTimestamp();
      
      // Should match format: YYYY-MM-DD HH:MM:SS
      expect(timestamp).to.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
    
  });
  
  describe("Color Codes", function() {
    
    it("should have all required color codes", function() {
      expect(colors).to.have.property('reset');
      expect(colors).to.have.property('green');
      expect(colors).to.have.property('red');
      expect(colors).to.have.property('yellow');
      expect(colors).to.have.property('blue');
      expect(colors).to.have.property('cyan');
    });
    
  });
  
});
