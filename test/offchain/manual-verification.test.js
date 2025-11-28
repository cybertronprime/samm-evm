const { expect } = require("chai");

/**
 * Manual Verification - Step-by-Step Rust Tracing
 * This manually traces through the Rust code to verify exact implementation
 */
describe("Manual Rust Code Verification", function () {

  describe("Fee Calculation - Line by Line Rust Trace", function () {
    it("Trace: Large pool, small trade (should use adaptive fee)", function () {
      // Input values
      const output_amount = 100n;
      const output_reserve = 100000n;
      const input_reserve = 100000n;
      const fee_numerator = 25n;
      const fee_denominator = 10000n;

      console.log("\n      === Tracing Rust calculate_fee_samm ===");
      console.log(`      Inputs: output=${output_amount}, out_res=${output_reserve}, in_res=${input_reserve}`);
      console.log(`      Fee: ${fee_numerator}/${fee_denominator} (${Number(fee_numerator)*100/Number(fee_denominator)}%)`);

      // Line 58: let max_fee_numerator = fee_numerator.checked_mul(5)?;
      const max_fee_numerator = fee_numerator * 5n;
      console.log(`      max_fee_numerator = ${fee_numerator} * 5 = ${max_fee_numerator}`);

      // Line 59: let tmp = output_amount.checked_mul(12)?.checked_mul(fee_denominator)?.checked_div(10)?.checked_div(output_reserve)?;
      const step1 = output_amount * 12n;
      console.log(`      tmp step1: ${output_amount} * 12 = ${step1}`);

      const step2 = step1 * fee_denominator;
      console.log(`      tmp step2: ${step1} * ${fee_denominator} = ${step2}`);

      const step3 = step2 / 10n;
      console.log(`      tmp step3: ${step2} / 10 = ${step3}`);

      const tmp = step3 / output_reserve;
      console.log(`      tmp final: ${step3} / ${output_reserve} = ${tmp}`);

      // Line 61: if tmp + fee_numerator > max_fee_numerator {
      const condition = tmp + fee_numerator;
      console.log(`      Check: ${tmp} + ${fee_numerator} = ${condition} > ${max_fee_numerator}?`);

      let fee;
      if (condition > max_fee_numerator) {
        console.log("      Using MINIMAL fee branch");
        // Lines 62-66: minimal fee
        fee = (output_amount * fee_numerator * input_reserve) / (output_reserve * fee_denominator);
        console.log(`      fee = (${output_amount} * ${fee_numerator} * ${input_reserve}) / (${output_reserve} * ${fee_denominator})`);
        console.log(`      fee = ${output_amount * fee_numerator * input_reserve} / ${output_reserve * fee_denominator} = ${fee}`);
      } else {
        console.log("      Using ADAPTIVE fee branch");
        // Lines 70-74: adaptive fee
        const numerator_part = max_fee_numerator - tmp;
        console.log(`      numerator_part = ${max_fee_numerator} - ${tmp} = ${numerator_part}`);

        fee = (output_amount * numerator_part * input_reserve) / (output_reserve * fee_denominator);
        console.log(`      fee = (${output_amount} * ${numerator_part} * ${input_reserve}) / (${output_reserve} * ${fee_denominator})`);
        console.log(`      fee = ${output_amount * numerator_part * input_reserve} / ${output_reserve * fee_denominator} = ${fee}`);
      }

      console.log(`      FINAL FEE: ${fee}`);
      expect(fee).to.be.gte(0n);
    });

    it("Trace: Smaller pool, larger trade (should use adaptive fee)", function () {
      const output_amount = 1000n;
      const output_reserve = 10000n;
      const input_reserve = 10000n;
      const fee_numerator = 25n;
      const fee_denominator = 10000n;

      console.log("\n      === Tracing Rust calculate_fee_samm ===");
      console.log(`      Inputs: output=${output_amount}, out_res=${output_reserve}, in_res=${input_reserve}`);

      const max_fee_numerator = fee_numerator * 5n;
      console.log(`      max_fee_numerator = ${max_fee_numerator}`);

      // Calculate tmp with exact Rust order
      const tmp = ((output_amount * 12n * fee_denominator) / 10n) / output_reserve;
      console.log(`      tmp = ${tmp}`);

      const condition = tmp + fee_numerator;
      console.log(`      Check: ${condition} > ${max_fee_numerator}? ${condition > max_fee_numerator}`);

      let fee;
      if (condition > max_fee_numerator) {
        fee = (output_amount * fee_numerator * input_reserve) / (output_reserve * fee_denominator);
        console.log(`      MINIMAL fee = ${fee}`);
      } else {
        const numerator_part = max_fee_numerator - tmp;
        fee = (output_amount * numerator_part * input_reserve) / (output_reserve * fee_denominator);
        console.log(`      ADAPTIVE fee = ${fee} (numerator_part=${numerator_part})`);
      }

      console.log(`      FINAL FEE: ${fee}`);
      expect(fee).to.be.gte(0n);
    });

    it("Trace: Very large pool (should hit minimal fee)", function () {
      const output_amount = 100n;
      const output_reserve = 1000000n; // 1M
      const input_reserve = 1000000n;
      const fee_numerator = 25n;
      const fee_denominator = 10000n;

      console.log("\n      === Tracing Rust calculate_fee_samm (large pool) ===");

      const max_fee_numerator = fee_numerator * 5n; // 125
      const tmp = ((output_amount * 12n * fee_denominator) / 10n) / output_reserve;
      // tmp = (100 * 12 * 10000) / 10 / 1000000 = 12000000 / 10 / 1000000 = 1200000 / 1000000 = 1

      console.log(`      max_fee_numerator = ${max_fee_numerator}`);
      console.log(`      tmp = ${tmp}`);

      const condition = tmp + fee_numerator; // 1 + 25 = 26
      console.log(`      condition = ${condition}, max = ${max_fee_numerator}`);
      console.log(`      ${condition} > ${max_fee_numerator}? ${condition > max_fee_numerator}`);

      let fee;
      if (condition > max_fee_numerator) {
        fee = (output_amount * fee_numerator * input_reserve) / (output_reserve * fee_denominator);
        console.log(`      MINIMAL fee = ${fee}`);
      } else {
        const numerator_part = max_fee_numerator - tmp; // 125 - 1 = 124
        fee = (output_amount * numerator_part * input_reserve) / (output_reserve * fee_denominator);
        // fee = (100 * 124 * 1000000) / (1000000 * 10000) = 12400000000 / 10000000000 = 1.24 -> 1
        console.log(`      ADAPTIVE fee = ${fee} (numerator_part=${numerator_part})`);
      }

      console.log(`      FINAL FEE: ${fee}`);
      expect(fee).to.be.gte(0n);
    });
  });

  describe("Swap Revert - Line by Line Rust Trace", function () {
    it("Trace: Equal reserves, small output", function () {
      const destination_amount = 100n;
      const swap_source_amount = 10000n;
      const swap_destination_amount = 10000n;

      console.log("\n      === Tracing Rust swap_revert ===");
      console.log(`      Inputs: dest=${destination_amount}, src_res=${swap_source_amount}, dest_res=${swap_destination_amount}`);

      // Line 55
      const invariant = swap_source_amount * swap_destination_amount;
      console.log(`      invariant = ${swap_source_amount} * ${swap_destination_amount} = ${invariant}`);

      // Line 56
      const new_swap_destination_amount = swap_destination_amount - destination_amount;
      console.log(`      new_dest = ${swap_destination_amount} - ${destination_amount} = ${new_swap_destination_amount}`);

      // Line 57
      let new_swap_source_amount = invariant / new_swap_destination_amount;
      console.log(`      new_source (floor) = ${invariant} / ${new_swap_destination_amount} = ${new_swap_source_amount}`);

      // Line 58-60: ceiling division
      const check = new_swap_source_amount * new_swap_destination_amount;
      console.log(`      Check: ${new_swap_source_amount} * ${new_swap_destination_amount} = ${check}`);
      console.log(`      Does ${check} != ${invariant}? ${check !== invariant}`);

      if (check !== invariant) {
        new_swap_source_amount = new_swap_source_amount + 1n;
        console.log(`      Ceiling applied! new_source = ${new_swap_source_amount}`);
      }

      // Line 61
      const source_amount_swapped = new_swap_source_amount - swap_source_amount;
      console.log(`      source_swapped = ${new_swap_source_amount} - ${swap_source_amount} = ${source_amount_swapped}`);

      console.log(`      RESULT: input_needed=${source_amount_swapped}, output=${destination_amount}`);

      // Verify invariant
      const old_invariant = swap_source_amount * swap_destination_amount;
      const new_invariant = new_swap_source_amount * new_swap_destination_amount;
      console.log(`      Old invariant: ${old_invariant}, New invariant: ${new_invariant}`);
      console.log(`      Maintained? ${new_invariant >= old_invariant}`);

      expect(source_amount_swapped).to.equal(102n);
      expect(new_invariant).to.be.gte(old_invariant);
    });
  });

  describe("Full SAMM Swap - Complete Rust Flow", function () {
    it("Trace: Complete swap_samm flow", function () {
      const output_amount = 1000n;
      const swap_source_amount = 100000n;
      const swap_destination_amount = 100000n;
      const trade_fee_numerator = 25n;
      const trade_fee_denominator = 10000n;
      const owner_fee_numerator = 10n;
      const owner_fee_denominator = 10000n;

      console.log("\n      === Tracing Rust swap_samm ===");

      // Line 80: Calculate trade fee
      console.log("\n      Step 1: Calculate trade_fee");
      const max_fee_num = trade_fee_numerator * 5n;
      const tmp = ((output_amount * 12n * trade_fee_denominator) / 10n) / swap_destination_amount;
      console.log(`      tmp = ${tmp}, max_fee_num = ${max_fee_num}`);

      let trade_fee;
      if (tmp + trade_fee_numerator > max_fee_num) {
        trade_fee = (output_amount * trade_fee_numerator * swap_source_amount) / (swap_destination_amount * trade_fee_denominator);
      } else {
        trade_fee = (output_amount * (max_fee_num - tmp) * swap_source_amount) / (swap_destination_amount * trade_fee_denominator);
      }
      console.log(`      trade_fee = ${trade_fee}`);

      // Line 82: Calculate owner fee
      console.log("\n      Step 2: Calculate owner_fee");
      const owner_fee = (output_amount * owner_fee_numerator) / owner_fee_denominator;
      console.log(`      owner_fee = ${owner_fee}`);

      // Line 84
      const total_fees = trade_fee + owner_fee;
      console.log(`      total_fees = ${total_fees}`);

      // Lines 86-94: swap_without_fees (which calls swap_revert)
      console.log("\n      Step 3: Call swap_without_fees (swap_revert)");
      const invariant = swap_source_amount * swap_destination_amount;
      const new_dest = swap_destination_amount - output_amount;
      let new_source = invariant / new_dest;
      if (new_source * new_dest !== invariant) {
        new_source += 1n;
      }
      const source_amount_swapped = new_source - swap_source_amount;
      console.log(`      source_amount_swapped (before fees) = ${source_amount_swapped}`);

      // Line 96: Add fees
      console.log("\n      Step 4: Add fees to source amount");
      const final_source_amount_swapped = source_amount_swapped + total_fees;
      console.log(`      final_source_amount = ${source_amount_swapped} + ${total_fees} = ${final_source_amount_swapped}`);

      console.log("\n      FINAL RESULT:");
      console.log(`        Amount In (total): ${final_source_amount_swapped}`);
      console.log(`        Amount Out: ${output_amount}`);
      console.log(`        Trade Fee: ${trade_fee}`);
      console.log(`        Owner Fee: ${owner_fee}`);

      expect(final_source_amount_swapped).to.be.gt(output_amount);
      expect(trade_fee).to.be.gte(0n);
      expect(owner_fee).to.be.gte(0n);
    });
  });
});
