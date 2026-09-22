/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/search', 'N/https'], (search, https) => {

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

            vendorSearch.run().each(result => {

                if (!vendor) {
                    vendor = {
                        id: String(vendorId),
                        entityid: result.getValue({name: 'entityid'}) || null,
                        externalid: result.getValue({name: 'externalid'}) || null,
                        companyname: result.getValue({name: 'companyname'}) || null,
                        altname: result.getValue({name: 'altname'}) || null,
                        email: result.getValue({name: 'email'}) || null,
                        phone: result.getValue({name: 'phone'}) || null,
                        isinactive: result.getValue({name: 'isinactive'}) ? 'T' : 'F',

                        // Primary subsidiary NAME
                        subsidiary: result.getText({name: 'subsidiarynohierarchy'}) || result.getValue({name: 'subsidiarynohierarchy'}) || null,

                        currency: '1',
                        terms: result.getValue({name: 'terms'}) || null,
                        category: result.getValue({name: 'category'}) || null,
                        datecreated: result.getValue({name: 'datecreated'}) || null,
                        lastmodifieddate: result.getValue({name: 'lastmodifieddate'}) || null,
                        defaultbillingaddress: null,
                        is1099eligible: result.getValue({name: 'is1099eligible'}) ? 'T' : 'F',
                        custentity_vb_ext_id_method_payment: result.getValue({name: 'custentity_vb_ext_id_method_payment'}) || null,
                        custentity_paymentmethod: result.getValue({name: 'custentity_paymentmethod'}) || null
                    };
                }

                const addressId = result.getValue({name: 'addressinternalid', join: 'Address'});

                if (addressId && !addressSeen[addressId]) {
                    addressSeen[addressId] = true;

                    const defaultBilling = result.getValue({name: 'isdefaultbilling', join: 'Address'});
                    const defaultShipping = result.getValue({name: 'isdefaultshipping', join: 'Address'});

                    if (defaultBilling === true || defaultBilling === 'T') defaultBillingAddress = String(addressId);

                    addresses.push({
                        vendor_id: String(vendorId),
                        address_id: String(addressId),
                        label: result.getValue({name: 'addresslabel', join: 'Address'}) || null,
                        defaultbilling: (defaultBilling === true || defaultBilling === 'T') ? 'T' : 'F',
                        defaultshipping: (defaultShipping === true || defaultShipping === 'T') ? 'T' : 'F',
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

                const subsidiaryInternalId = result.getValue({name: 'internalid', join: 'mseSubsidiary'});
                const subsidiaryName = result.getValue({name: 'namenohierarchy', join: 'mseSubsidiary'});

                if (subsidiaryInternalId && subsidiaryName && !subsidiarySeen[subsidiaryInternalId]) {
                    subsidiarySeen[subsidiaryInternalId] = true;

                    subsidiaries.push({
                        entity: String(vendorId),
                        subsidiary: String(subsidiaryName)
                    });
                }

                return true;
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

            log.audit('Vendor Data', JSON.stringify(vendor));
            log.audit('Address Count', addresses.length);
            log.audit('Address Data', JSON.stringify(addresses));
            log.audit('Subsidiary Count', subsidiaries.length);
            log.audit('Payload Length', payloadString.length);
            log.audit('FINAL VB VENDOR PAYLOAD', payloadString);


            // =====================================================
            // TESTING ONLY
            // NOTHING IS BEING SENT
            // =====================================================

            /*
            const response = https.post({
                url: 'https://apdev.verticalbridge.com/VendorApi/vendor',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': 'API_KEY_HERE'
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