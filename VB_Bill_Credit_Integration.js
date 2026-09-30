/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/format', 'N/log'], (record, format, log) => {

    const empty = v => v === null || v === undefined || String(v).trim() === '';
    const date = v => format.parse({ value: String(v), type: format.Type.DATE });

    function setBody(rec, data) {
        const skip = ['recordType', 'purchaseOrderId', 'item', 'expense'];

        Object.keys(data).forEach(f => {
            if (skip.includes(f) || empty(data[f]) || typeof data[f] === 'object') return;

            try {
                let value = ['trandate', 'duedate'].includes(f) ? date(data[f]) : data[f];
                rec.setValue({ fieldId: f, value });
                log.debug('BODY SET', `${f} = ${data[f]}`);
            } catch (e) {
                log.error(`BODY FIELD ERROR: ${f}`, e.message);
                throw e;
            }
        });
    }

    function setLine(rec, sublist, line) {
        Object.keys(line).forEach(f => {
            if (['orderline', 'item'].includes(f) || empty(line[f])) return;

            try {
                rec.setCurrentSublistValue({ sublistId: sublist, fieldId: f, value: line[f] });
                log.debug('LINE SET', `${f} = ${line[f]}`);
            } catch (e) {
                log.error(`LINE FIELD ERROR: ${f}`, e.message);
                throw e;
            }
        });
    }

    function createPO(data) {
        const rec = record.create({ type: record.Type.PURCHASE_ORDER, isDynamic: true });

        setBody(rec, data);

        (data.item || []).forEach((line, i) => {
            rec.selectNewLine({ sublistId: 'item' });

            rec.setCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                value: line.item
            });

            setLine(rec, 'item', line);
            rec.commitLine({ sublistId: 'item' });

            log.debug('PO LINE CREATED', { line: i + 1, item: line.item });
        });

        return rec.save({ enableSourcing: true, ignoreMandatoryFields: false });
    }

    function findLine(rec, data) {
        const count = rec.getLineCount({ sublistId: 'item' });

        for (let i = 0; i < count; i++) {
            const item = rec.getSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                line: i
            });

            const orderline = rec.getSublistValue({
                sublistId: 'item',
                fieldId: 'orderline',
                line: i
            });

            if (
                (!empty(data.orderline) && String(orderline) === String(data.orderline)) ||
                (empty(data.orderline) && !empty(data.item) && String(item) === String(data.item))
            ) return i;
        }

        return -1;
    }

    function transformPO(data, toType) {
        if (empty(data.purchaseOrderId)) throw Error('purchaseOrderId is required');

        const rec = record.transform({
            fromType: record.Type.PURCHASE_ORDER,
            fromId: data.purchaseOrderId,
            toType,
            isDynamic: true
        });

        setBody(rec, data);

        if (toType === record.Type.ITEM_RECEIPT) {
            const count = rec.getLineCount({ sublistId: 'item' });

            for (let i = 0; i < count; i++) {
                rec.selectLine({ sublistId: 'item', line: i });
                rec.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemreceive',
                    value: false
                });
                rec.commitLine({ sublistId: 'item' });
            }
        }

        (data.item || []).forEach(line => {
            const i = findLine(rec, line);

            if (i === -1) {
                log.error('LINE NOT FOUND', line);
                return;
            }

            rec.selectLine({ sublistId: 'item', line: i });

            if (toType === record.Type.ITEM_RECEIPT) {
                rec.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemreceive',
                    value: true
                });
            }

            setLine(rec, 'item', line);
            rec.commitLine({ sublistId: 'item' });

            log.debug('TRANSFORM LINE UPDATED', {
                line: i,
                item: line.item,
                orderline: line.orderline
            });
        });

        return rec.save({ enableSourcing: true, ignoreMandatoryFields: false });
    }

    function post(data) {
        try {
            log.audit('RESTLET START', data);

            if (!data || !data.recordType)
                return { Status: 'failed', Message: 'recordType is required' };

            const type = String(data.recordType).toLowerCase();
            let id;

            if (type === 'purchaseorder')
                id = createPO(data);

            else if (type === 'itemreceipt')
                id = transformPO(data, record.Type.ITEM_RECEIPT);

            else if (type === 'vendorbill')
                id = transformPO(data, record.Type.VENDOR_BILL);

            else
                return { Status: 'failed', Message: `Invalid recordType: ${data.recordType}` };

            log.audit('RECORD CREATED', { type, id });

            return {
                Status: 'success',
                Code: 200,
                recordType: type,
                internalId: id
            };

        } catch (e) {
            log.error('RESTLET ERROR', {
                name: e.name,
                message: e.message,
                stack: e.stack
            });

            return {
                Status: 'failed',
                Code: 500,
                Message: e.message
            };
        }
    }

    return { post };
});