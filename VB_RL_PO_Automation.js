/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/format', 'N/log'], (record, search, format, log) => {

  const post = payload => {
    let stage = 'Validation', ref = '';

    try {
      if (!payload?.otherrefnum || !payload.entity || !Array.isArray(payload.expense) || !payload.expense.length)
        return { Status: 'failed', Code: 400, Message: 'otherrefnum, entity and expense lines are required.' };

      ref = String(payload.otherrefnum).trim();

      for (const [i, line] of payload.expense.entries())
        if (!line.account || line.amount === '' || line.amount == null ||
            !Number.isFinite(Number(line.amount)) || Number(line.amount) === 0)
          return { Status: 'failed', Code: 400, Message: `Invalid account or amount on expense line ${i + 1}`, OtherRefNum: ref };

      // Search exact Other Reference Number
      stage = 'Search Purchase Order';

      const results = search.create({
        type: record.Type.PURCHASE_ORDER,
        filters: [
          ['mainline', 'is', 'T'], 'AND',
          ['formulatext: {otherrefnum}', 'is', ref]
        ],
        columns: ['internalid', 'otherrefnum']
      }).run().getRange({ start: 0, end: 1000 });

      const matches = results.filter(r =>
        String(r.getValue({ name: 'otherrefnum' }) || '').trim() === ref
      );

      if (matches.length > 1)
        return {
          Status: 'failed',
          Code: 409,
          Message: 'Multiple Purchase Orders have the exact same Other Reference Number.',
          OtherRefNum: ref,
          MatchingIds: matches.map(r => r.id)
        };

      const existingId = matches.length ? matches[0].id : null;
      const action = existingId ? 'updated' : 'created';

      // Create or load PO
      stage = 'Initialize Purchase Order';
      const rec = existingId
        ? record.load({ type: record.Type.PURCHASE_ORDER, id: existingId, isDynamic: true })
        : record.create({ type: record.Type.PURCHASE_ORDER, isDynamic: true });

      // Set primary fields
      stage = 'Set Header Fields';

      if (payload.customform)
        rec.setValue({ fieldId: 'customform', value: Number(payload.customform) });

      rec.setValue({ fieldId: 'entity', value: Number(payload.entity) });

      if (payload.subsidiary && Number(rec.getValue({ fieldId: 'subsidiary' })) !== Number(payload.subsidiary))
        rec.setValue({ fieldId: 'subsidiary', value: Number(payload.subsidiary) });

      // Dynamic header mapping
      for (const [key, value] of Object.entries(payload)) {
        if (['expense', 'item', 'usertotal', 'transactiontype', 'customform1',
             'duedate', 'tranid', 'customform', 'entity', 'subsidiary'].includes(key) ||
            value === null || value === undefined || value === '') continue;

        stage = `Set Header: ${key}`;

        rec.setValue({
          fieldId: key,
          value: key === 'trandate' && typeof value === 'string'
            ? format.parse({ value, type: format.Type.DATE })
            : value
        });
      }

      // Replace existing expense lines
      stage = 'Replace Expense Lines';
      const oldLines = rec.getLineCount({ sublistId: 'expense' });

      for (let i = oldLines - 1; i >= 0; i--)
        rec.removeLine({ sublistId: 'expense', line: i, ignoreRecalc: true });

      // Add incoming expense lines
      for (const [i, line] of payload.expense.entries()) {
        stage = `Expense Line ${i + 1}`;
        rec.selectNewLine({ sublistId: 'expense' });

        rec.setCurrentSublistValue({
          sublistId: 'expense',
          fieldId: 'account',
          value: Number(line.account)
        });

        for (const [key, value] of Object.entries(line)) {
          if (['account', 'transactiontype'].includes(key) ||
              value === null || value === undefined || value === '') continue;

          stage = `Expense Line ${i + 1}: ${key}`;

          rec.setCurrentSublistValue({
            sublistId: 'expense',
            fieldId: key,
            value: key === 'amount' ? Number(value) : value
          });
        }

        rec.commitLine({ sublistId: 'expense' });
      }

      // Save
      stage = 'Save Purchase Order';
      const id = rec.save({ enableSourcing: true, ignoreMandatoryFields: false });

      const result = {
        purchaseOrderId: id,
        otherrefnum: ref,
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
      log.error('PO RESTlet Error', { otherrefnum: ref, stage, error: e.message || String(e) });
      return {
        Status: 'failed',
        Code: 500,
        Message: e.message || String(e),
        OtherRefNum: ref,
        Stage: stage,
        ErrorCode: e.name || 'UNEXPECTED_ERROR'
      };
    }
  };

  return {
    get: context => ({
      Status: 'success',
      Code: 200,
      Message: 'success GET',
      Params: context || {}
    }),
    post
  };
});
