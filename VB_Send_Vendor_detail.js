/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/search', 'N/https'], (search, https) => {

    // Converts checkbox values (boolean or 'T'/'F') to 'T'/'F'
    const toTF = (v) => (v === true || v === 'T') ? 'T' : 'F';

    const afterSubmit = (context) => {
        try {
            if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) return;

            const vendorId = context.newRecord.id;
            log.audit('Vendor ID', vendorId);

            const vendorSearch = search.load({
                id: 'customsearch_vb_vendor_detail'
            });

            vendorSearch.filters.push(search.createFilter({
                name: 'internalid',
                operator: search.Operator.ANYOF,
                values: vendorId
            }));

            let vendor = null;
            let addresses = [];
            let subsidiaries = [];
            let addressSeen = {};
            let subsidiarySeen = {};
            let defaultBillingAddress = null;

            const processResult = (result) => {

                // ---------- Vendor (first row only) ----------
                if (!vendor) {
                    vendor = {
                        id: String(vendorId),
                        entityid: result.getValue({name: 'entityid'}) || null,
                        externalid: result.getValue({name: 'externalid'}) || null,
                        companyname: result.getValue({name: 'companyname'}) || null,
                        altname: result.getValue({name: 'altname'}) || null,
                        email: result.getValue({name: 'email'}) || null,
                        phone: result.getValue({name: 'phone'}) || null,
                        isinactive: toTF(result.getValue({name: 'isinactive'})),
                        subsidiary: result.getValue({name: 'subsidiarynohierarchy'}) || null,     // internal ID
                        currency: result.getValue({name: 'currency'}) || null,                    // requires Currency column in saved search
                        terms: result.getValue({name: 'terms'}) || null,
                        category: result.getValue({name: 'category'}) || null,
                        datecreated: result.getValue({name: 'datecreated'}) || null,
                        lastmodifieddate: result.getValue({name: 'lastmodifieddate'}) || null,
                        defaultbillingaddress: null,
                        is1099eligible: toTF(result.getValue({name: 'is1099eligible'})),
                        custentity_vb_ext_id_method_payment: result.getText({name: 'custentity_vb_ext_id_method_payment'}) || null, // text, e.g. "ACH"
                        custentity_paymentmethod: result.getValue({name: 'custentity_paymentmethod'}) || null
                    };
                }

                // ---------- Addresses ----------
                const addressId = result.getValue({name: 'addressinternalid', join: 'Address'});

                if (addressId && !addressSeen[addressId]) {
                    addressSeen[addressId] = true;

                    const defaultBilling = toTF(result.getValue({name: 'isdefaultbilling', join: 'Address'}));
                    const defaultShipping = toTF(result.getValue({name: 'isdefaultshipping', join: 'Address'}));

                    if (defaultBilling === 'T') defaultBillingAddress = String(addressId);

                    addresses.push({
                        vendor_id: String(vendorId),
                        address_id: String(addressId),
                        label: result.getValue({name: 'addresslabel', join: 'Address'}) || null,
                        defaultbilling: defaultBilling,
                        defaultshipping: defaultShipping,
                        addressee: result.getValue({name: 'addressee', join: 'Address'}) || null,
                        attention: result.getValue({name: 'attention', join: 'Address'}) || null,
                        addr1: result.getValue({name: 'address1', join: 'Address'}) || null,
                        addr2: result.getValue({name: 'address2', join: 'Address'}) || null,
                        addr3: result.getValue({name: 'address3', join: 'Address'}) || null,
                        city: result.getValue({name: 'city', join: 'Address'}) || null,
                        state: result.getValue({name: 'state', join: 'Address'}) || null,
                        zip: result.getValue({name: 'zipcode', join: 'Address'}) || null,
                        country: result.getValue({name: 'countrycode', join: 'Address'}) || null,
                        addrphone: result.getValue({name: 'addressphone', join: 'Address'}) || null
                    });
                }

                // ---------- Subsidiaries (internal IDs) ----------
                const subsidiaryInternalId = result.getValue({name: 'internalid', join: 'mseSubsidiary'});

                if (subsidiaryInternalId && !subsidiarySeen[subsidiaryInternalId]) {
                    subsidiarySeen[subsidiaryInternalId] = true;

                    subsidiaries.push({
                        entity: String(vendorId),
                        subsidiary: String(subsidiaryInternalId)
                    });
                }
            };

            // Paged run avoids the 4,000-row limit of run().each()
            // (rows = addresses x subsidiaries)
            const paged = vendorSearch.runPaged({pageSize: 1000});
            paged.pageRanges.forEach(range => {
                paged.fetch({index: range.index}).data.forEach(processResult);
            });

            if (!vendor) {
                log.error('Vendor Search', 'No Vendor result found for ID ' + vendorId);
                return;
            }

            vendor.defaultbillingaddress = defaultBillingAddress;

            const payload = {
                schema_version: '1',
                op: 'upsert',
                vendor_id: String(vendorId),
                vendor: vendor,
                addresses: addresses,
                subsidiaries: subsidiaries,
                allow_empty_addresses: false,
                allow_empty_subsidiaries: false
            };

            const payloadString = JSON.stringify(payload);

            log.audit('Address Count', addresses.length);
            log.audit('Subsidiary Count', subsidiaries.length);
            log.audit('Payload Length', payloadString.length);

            // '>> ' prefix stops the Execution Log UI from reformatting the JSON fragments
            for (let i = 0; i < payloadString.length; i += 3500) {
                log.audit('VB Payload Part ' + ((i / 3500) + 1), '>> ' + payloadString.substring(i, i + 3500));
            }


            // =========================================================
            // API SEND - CURRENTLY COMMENTED OUT
            // REMOVE /* AND */ BELOW WHEN READY TO SEND
            // =========================================================

            /*
            const response = https.post({
                url: 'https://apdev.verticalbridge.com/VendorApi/vendor',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': 'YOUR_DEV_API_KEY'
                },
                body: payloadString
            });

            log.audit('VB API Response Code', response.code);
            log.audit('VB API Response Body', response.body);
            */


        } catch (e) {
            log.error('VB Vendor Integration Error', e);
        }
    };

    return {afterSubmit};
});