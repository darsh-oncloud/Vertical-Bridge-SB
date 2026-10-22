
/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/format', 'N/log'], (record, format, log) => {

  function createTransaction(recType, payload, lines) {
    const rec = record.create({ type: recType, isDynamic: true });

    for (const key in payload) {
      if (['expense', 'item', 'customform', 'customform1', 'usertotal'].includes(key)) continue;
      const value = payload[key];
      if (value === null || value === undefined || value === '') continue;

      rec.setValue({
        fieldId: key,
        value: ['trandate', 'duedate'].includes(key)
          ? format.parse({ value: String(value), type: format.Type.DATE })
          : value
      });
    }

    lines.forEach(line => {
      rec.selectNewLine({ sublistId: 'expense' });

      for (const key in line) {
        if (key === 'transactiontype' || line[key] === null || line[key] === undefined || line[key] === '') continue;
        rec.setCurrentSublistValue({ sublistId: 'expense', fieldId: key, value: line[key] });
      }

      rec.commitLine({ sublistId: 'expense' });
    });

    return rec.save({ enableSourcing: true, ignoreMandatoryFields: false });
  }

  function doPost(context) {
    try {
      if (!context || !context.entity || !Array.isArray(context.expense) || !context.expense.length) {
        return { Status: 'failed', Code: 400, Message: 'Vendor and expense lines are required.' };
      }

      let debit = 0, credit = 0, debitCount = 0, creditCount = 0;

      context.expense.forEach((line, i) => {
        const type = String(line.transactiontype || 'Debit').trim().toLowerCase();
        const amount = Number(line.amount);

        if (!['debit', 'credit'].includes(type) || !Number.isFinite(amount) || amount <= 0) {
          throw new Error('Invalid transaction type or amount on line ' + (i + 1));
        }

        if (type === 'credit') { credit += Math.round(amount * 100); creditCount++; }
        else { debit += Math.round(amount * 100); debitCount++; }
      });

      const net = (debit - credit) / 100;
      if (net === 0) return { Status: 'failed', Code: 400, Message: 'Net amount is zero. No transaction created.' };

      const isBill = net > 0;
      const recType = isBill ? record.Type.VENDOR_BILL : record.Type.VENDOR_CREDIT;

      // Debit + / Credit - for Bill; reverse signs for Vendor Credit
      const lines = context.expense.map(line => {
        const isCredit = String(line.transactiontype || 'Debit').trim().toLowerCase() === 'credit';
        const amount = Math.round(Number(line.amount) * 100) / 100;
        return { ...line, amount: amount * (isBill ? (isCredit ? -1 : 1) : (isCredit ? 1 : -1)) };
      });

      // Validate against Core header total before creating transaction
      if (context.usertotal !== undefined && context.usertotal !== null &&
          Math.round(Math.abs(Number(context.usertotal)) * 100) !== Math.round(Math.abs(net) * 100)) {
        return { Status: 'failed', Code: 400, Message: 'Header total does not match calculated net amount: ' + net };
      }

      const id = createTransaction(recType, context, lines);

      // Preserve existing mixed-bill approval behavior
      const approved = isBill && debitCount > 0 && creditCount > 0;
      if (approved) record.submitFields({ type: record.Type.VENDOR_BILL, id, values: { approvalstatus: 2 } });

      const result = {
        vendorBillId: isBill ? id : null,
        vendorCreditId: isBill ? null : id,
        transactionType: isBill ? 'Vendor Bill' : 'Vendor Credit',
        calculation: {
          totalDebit: debit / 100,
          totalCredit: credit / 100,
          netAmount: net,
          transactionAmount: Math.abs(net),
          debitLines: debitCount,
          creditLines: creditCount,
          totalLines: lines.length
        },
        billApproved: approved,
        recordsCreated: 1
      };

      log.audit('Transaction Created', result);
      return { Status: 'success', Code: 200, Message: 'Record processed successfully', Data: result };

    } catch (e) {
      log.error('RESTlet Error', e);
      return { Status: 'failed', Code: 500, Message: e.message || String(e) };
    }
  }

  return {
    get: context => ({ Status: 'success', Code: 200, Message: 'success GET', Params: context || {} }),
    post: doPost
  };
});
