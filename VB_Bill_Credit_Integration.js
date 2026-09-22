/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/format', 'N/log', 'N/search'], function (record, format, log, search) {

  function isEmpty(v) {
    return v === null || v === undefined || String(v).trim() === '';
  }

  function isObject(o) {
    return o && typeof o === 'object' && !Array.isArray(o);
  }

  function parseNsDate(v) {
    if (isEmpty(v)) return null;
    return format.parse({
      value: String(v),
      type: format.Type.DATE
    });
  }

  function respSuccess(data) {
    return {
      Status: 'success',
      Code: 200,
      Message: 'Record processed successfully',
      Data: data
    };
  }

  function respFail(code, msg) {
    return {
      Status: 'failed',
      Code: code,
      Message: msg
    };
  }

  function setBodyFields(recObj, payload) {
    for (var k in payload) {
      if (!payload.hasOwnProperty(k)) continue;

      if (
        k === 'expense' ||
        k === 'item' ||
        k === 'customform' ||
        k === 'customform1' ||
        k === 'usertotal'
      ) {
        continue;
      }

      var val = payload[k];
      if (isEmpty(val)) continue;

      if (k === 'trandate' || k === 'duedate') {
        var d = parseNsDate(val);
        if (d) {
          recObj.setValue({
            fieldId: k,
            value: d
          });
        }
      } else {
        recObj.setValue({
          fieldId: k,
          value: val
        });
      }
    }
  }

  function setLineFields(recObj, sublistId, lineObj) {
    for (var k in lineObj) {
      if (!lineObj.hasOwnProperty(k)) continue;
      if (k === 'transactiontype') continue;

      var val = lineObj[k];
      if (isEmpty(val)) continue;

      recObj.setCurrentSublistValue({
        sublistId: sublistId,
        fieldId: k,
        value: val
      });
    }
  }

  function splitLines(lines) {
    var out = {
      debit: [],
      credit: []
    };

    if (!Array.isArray(lines)) return out;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!isObject(line)) continue;

      var type = String(line.transactiontype || 'Debit').toLowerCase();

      if (type === 'credit') {
        out.credit.push(line);
      } else {
        out.debit.push(line);
      }
    }

    return out;
  }

  function createTransaction(recType, payload, expenseLines) {
    var recObj = record.create({
      type: recType,
      isDynamic: true
    });

    setBodyFields(recObj, payload);

    for (var i = 0; i < expenseLines.length; i++) {
      recObj.selectNewLine({
        sublistId: 'expense'
      });

      setLineFields(recObj, 'expense', expenseLines[i]);

      recObj.commitLine({
        sublistId: 'expense'
      });
    }

    return recObj.save({
      enableSourcing: true,
      ignoreMandatoryFields: false
    });
  }

  function approveVendorBill(billId) {
    if (isEmpty(billId)) return false;

    record.submitFields({
      type: record.Type.VENDOR_BILL,
      id: billId,
      values: {
        approvalstatus: 2
      },
      options: {
        enableSourcing: false,
        ignoreMandatoryFields: true
      }
    });

    return true;
  }

  function getBillApprovalStatus(billId) {
    if (isEmpty(billId)) return '';

    var data = search.lookupFields({
      type: record.Type.VENDOR_BILL,
      id: billId,
      columns: ['approvalstatus']
    });

    if (data && data.approvalstatus && data.approvalstatus.length > 0) {
      return data.approvalstatus[0].text || '';
    }

    return '';
  }

  function applyVendorCredit(creditId, billId) {
    var appliedBills = [];

    if (isEmpty(creditId) || isEmpty(billId)) {
      return appliedBills;
    }

    var vc = record.load({
      type: record.Type.VENDOR_CREDIT,
      id: creditId,
      isDynamic: true
    });

    var lineCount = vc.getLineCount({
      sublistId: 'apply'
    });

    log.debug('Vendor Credit Apply Line Count', {
      creditId: creditId,
      billId: billId,
      lineCount: lineCount
    });

    if (!lineCount || lineCount <= 0) {
      return appliedBills;
    }

    var creditTotal = parseFloat(vc.getValue({
      fieldId: 'usertotal'
    })) || 0;

    if (creditTotal <= 0) {
      return appliedBills;
    }

    for (var i = 0; i < lineCount; i++) {
      var applyBillId = vc.getSublistValue({
        sublistId: 'apply',
        fieldId: 'internalid',
        line: i
      });

      log.debug('Apply Line Check', {
        applyBillId: applyBillId,
        targetBillId: billId
      });

      if (String(applyBillId) === String(billId)) {
        vc.selectLine({
          sublistId: 'apply',
          line: i
        });

        var due = parseFloat(vc.getCurrentSublistValue({
          sublistId: 'apply',
          fieldId: 'due'
        })) || 0;

        var applyAmt = due < creditTotal ? due : creditTotal;

        if (applyAmt > 0) {
          vc.setCurrentSublistValue({
            sublistId: 'apply',
            fieldId: 'apply',
            value: true
          });

          vc.setCurrentSublistValue({
            sublistId: 'apply',
            fieldId: 'amount',
            value: applyAmt
          });

          appliedBills.push({
            billId: String(applyBillId),
            amount: applyAmt
          });
        }

        vc.commitLine({
          sublistId: 'apply'
        });

        break;
      }
    }

    if (appliedBills.length > 0) {
      vc.save({
        enableSourcing: true,
        ignoreMandatoryFields: false
      });
    }

    return appliedBills;
  }

  function doPost(context) {
    try {
      log.audit('RESTlet POST Started', {
        entity: context && context.entity,
        tranid: context && context.tranid
      });

      if (!isObject(context)) {
        return respFail(400, 'POST body must be a JSON object');
      }

      if (isEmpty(context.entity)) {
        return respFail(400, 'Missing required field: entity');
      }

      var expenseSplit = splitLines(context.expense);

      var hasDebit = expenseSplit.debit.length > 0;
      var hasCredit = expenseSplit.credit.length > 0;

      if (!hasDebit && !hasCredit) {
        return respFail(400, 'Payload must include Debit or Credit lines in expense array');
      }

      var result = {
        vendorBillId: null,
        vendorCreditId: null,
        billApproved: false,
        billApprovalStatus: '',
        appliedBills: [],
        applyMessage: ''
      };

      var shouldApproveBill = hasDebit && hasCredit;

      if (hasDebit) {
        result.vendorBillId = createTransaction(
          record.Type.VENDOR_BILL,
          context,
          expenseSplit.debit
        );

        if (shouldApproveBill) {
          approveVendorBill(result.vendorBillId);
          result.billApproved = true;
          result.billApprovalStatus = getBillApprovalStatus(result.vendorBillId);
        } else {
          result.billApprovalStatus = getBillApprovalStatus(result.vendorBillId);
        }
      }

      if (hasCredit) {
        result.vendorCreditId = createTransaction(
          record.Type.VENDOR_CREDIT,
          context,
          expenseSplit.credit
        );
      }

      if (result.vendorCreditId && result.vendorBillId) {
        result.appliedBills = applyVendorCredit(
          result.vendorCreditId,
          result.vendorBillId
        );

        if (result.appliedBills.length > 0) {
          result.applyMessage = 'Vendor Credit applied to Vendor Bill successfully.';
        } else {
          result.applyMessage = 'Vendor Credit created, but Vendor Bill was not found in Apply tab.';
        }
      } else if (result.vendorBillId && !result.vendorCreditId) {
        result.applyMessage = 'Only Debit lines received. Vendor Bill created and kept in default approval status.';
      } else if (result.vendorCreditId && !result.vendorBillId) {
        result.applyMessage = 'Only Credit lines received. Vendor Credit created but not applied.';
      }

      log.audit('RESTlet Success', result);

      return respSuccess(result);

    } catch (e) {
      log.error('RESTlet POST Error', e);

      var msg = e && e.message ? e.message : String(e);
      var code = 500;
      var name = e && e.name ? e.name : '';

      if (
        name === 'USER_ERROR' ||
        name === 'SSS_MISSING_REQD_ARGUMENT' ||
        name === 'INVALID_FLD_VALUE'
      ) {
        code = 400;
      }

      return respFail(code, msg);
    }
  }

  function doGet(context) {
    return {
      Status: 'success',
      Code: 200,
      Message: 'success GET',
      Params: context || {}
    };
  }

  return {
    get: doGet,
    post: doPost
  };
});