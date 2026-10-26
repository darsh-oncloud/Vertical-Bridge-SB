/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/format', 'N/log'], (record, search, format, log) => {

  function doPost(payload) {
    let stage = 'Validation', otherrefnum = '';

    try {
      if (!payload?.otherrefnum || !payload.entity || !Array.isArray(payload.expense) || !payload.expense.length)
        return { Status: 'failed', Code: 400, Message: 'otherrefnum, entity and expense lines are required.' };

      otherrefnum = String(payload.otherrefnum).trim();
      if (!otherrefnum) return { Status: 'failed', Code: 400, Message: 'Invalid otherrefnum.' };

      for (const [i, line] of payload.expense.entries()) {
        if (!line.account || line.amount === null || line.amount === undefined ||
            line.amount === '' || !Number.isFinite(Number(line.amount)) || Number(line.amount) === 0)
          return { Status: 'failed', Code: 400, Message: `Invalid account or amount on expense line ${i + 1}`, TranId: tranid };
      }

      // Search existing Purchase Order
      stage = 'Search Purchase Order';
      const results = search.create({
        type: record.Type.PURCHASE_ORDER,
        filters: [['otherrefnum', 'is', otherrefnum], 'AND', ['mainline', 'is', 'T']],
        columns: ['internalid']
      }).run().getRange({ start: 0, end: 2 });

      if (results.length > 1)
        return { Status: 'failed', Code: 409, Message: 'Multiple Purchase Orders found with the same tranid.', TranId: tranid };

      const existingId = results.length ? results[0].id : null;
      const action = existingId ? 'updated' : 'created';

      // Load existing PO or create new PO
      stage = 'Initialize Purchase Order';
      const rec = existingId
        ? record.load({ type: record.Type.PURCHASE_ORDER, id: existingId, isDynamic: true })
        : record.create({ type: record.Type.PURCHASE_ORDER, isDynamic: true });

      // Set form and primary fields first
      stage = 'Set Header Fields';
      // for (const key of ['customform', 'subsidiary', 'entity']) {
      //   if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '')
      //     rec.setValue({ fieldId: key, value: payload[key] });
      // }

for (const key of ['customform', 'entity', 'subsidiary']) {
  if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '')
    rec.setValue({ fieldId: key, value: Number(payload[key]) });
}
      
      // Dynamically set all other header fields
      for (const [key, value] of Object.entries(payload)) {
        if (['expense', 'item', 'usertotal', 'transactiontype', 'customform1', 'duedate',
             'customform', 'subsidiary', 'entity'].includes(key) ||
            value === null || value === undefined || value === '') continue;

        rec.setValue({
          fieldId: key,
          value: key === 'trandate' && typeof value === 'string'
            ? format.parse({ value, type: format.Type.DATE })
            : value
        });
      }

      // Remove existing expense lines on update
      stage = 'Replace Expense Lines';
      const oldLines = rec.getLineCount({ sublistId: 'expense' });

      for (let i = oldLines - 1; i >= 0; i--)
        rec.removeLine({ sublistId: 'expense', line: i, ignoreRecalc: true });

      // Add incoming expense lines dynamically
      for (const [i, line] of payload.expense.entries()) {
        stage = `Add Expense Line ${i + 1}`;
        rec.selectNewLine({ sublistId: 'expense' });

        // Account first
        rec.setCurrentSublistValue({ sublistId: 'expense', fieldId: 'account', value: line.account });

        for (const [key, value] of Object.entries(line)) {
          if (['account', 'transactiontype'].includes(key) ||
              value === null || value === undefined || value === '') continue;

          rec.setCurrentSublistValue({
            sublistId: 'expense',
            fieldId: key,
            value: key === 'amount' ? Number(value) : value
          });
        }

        rec.commitLine({ sublistId: 'expense' });
      }

      // Save Purchase Order
      stage = 'Save Purchase Order';
      const id = rec.save({ enableSourcing: true, ignoreMandatoryFields: false });

      const result = {
        purchaseOrderId: id,
        otherrefnum,
        action,
        previousLines: oldLines,
        totalLines: payload.expense.length,
        recordsCreated: existingId ? 0 : 1,
        recordsUpdated: existingId ? 1 : 0
      };

      log.audit(`Purchase Order ${action}`, result);

      return {
        Status: 'success',
        Code: 200,
        Message: `Purchase Order ${action} successfully.`,
        Data: result
      };

    } catch (e) {
      log.error('PO RESTlet Error', { otherrefnum, stage, error: e.message || String(e) });
      return {
        Status: 'failed',
        Code: 500,
        Message: e.message || String(e),
        otherrefnum: otherrefnum,
        Stage: stage,
        ErrorCode: e.name || 'UNEXPECTED_ERROR'
      };
    }
  }

  return {
    get: context => ({
      Status: 'success',
      Code: 200,
      Message: 'success GET',
      Params: context || {}
    }),
    post: doPost
  };
});
