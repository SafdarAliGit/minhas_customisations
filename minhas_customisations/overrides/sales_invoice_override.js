frappe.provide("minhase_customisations");
frappe.provide("erpnext.accounts");

minhase_customisations.CustomSalesInvoiceController = class CustomSalesInvoiceController extends erpnext.accounts.SalesInvoiceController {
	serial_number() {
		let me = this;
		if (me.frm.doc.serial_number) {
			me.frm.set_value('scan_barcode', me.frm.doc.serial_number);
			me.frm.set_value('serial_number', null);
		}
		console.log('hello world')
	}


	item_code(doc, cdt, cdn) {
		var me = this;
		var item = frappe.get_doc(cdt, cdn);
		var update_stock = 0, show_batch_dialog = 0;

		item.weight_per_unit = 0;
		item.weight_uom = '';
		item.conversion_factor = 0;

		if(['Sales Invoice'].includes(this.frm.doc.doctype)) {
			update_stock = cint(me.frm.doc.update_stock);
			show_batch_dialog = update_stock;

		} else if((this.frm.doc.doctype === 'Purchase Receipt' && me.frm.doc.is_return) ||
			this.frm.doc.doctype === 'Delivery Note') {
			show_batch_dialog = 1;
		}
		item.barcode = null;


		if(item.item_code || item.serial_no) {
			if(!this.validate_company_and_party()) {
				this.frm.fields_dict["items"].grid.grid_rows[item.idx - 1].remove();
			} else {
				return this.frm.call({
					method: "erpnext.stock.get_item_details.get_item_details",
					child: item,
					args: {
						doc: me.frm.doc,
						args: {
							item_code: item.item_code,
							barcode: item.barcode,
							serial_no: item.serial_no,
							batch_no: item.batch_no,
							set_warehouse: me.frm.doc.set_warehouse,
							warehouse: item.warehouse,
							customer: me.frm.doc.customer || me.frm.doc.party_name,
							quotation_to: me.frm.doc.quotation_to,
							supplier: me.frm.doc.supplier,
							currency: me.frm.doc.currency,
							update_stock: update_stock,
							conversion_rate: me.frm.doc.conversion_rate,
							price_list: me.frm.doc.selling_price_list || me.frm.doc.buying_price_list,
							price_list_currency: me.frm.doc.price_list_currency,
							plc_conversion_rate: me.frm.doc.plc_conversion_rate,
							company: me.frm.doc.company,
							order_type: me.frm.doc.order_type,
							is_pos: cint(me.frm.doc.is_pos),
							is_return: cint(me.frm.doc.is_return),
							is_subcontracted: me.frm.doc.is_subcontracted,
							ignore_pricing_rule: me.frm.doc.ignore_pricing_rule,
							doctype: me.frm.doc.doctype,
							name: me.frm.doc.name,
							project: item.project || me.frm.doc.project,
							qty: item.qty || 1,
							net_rate: item.rate,
							stock_qty: item.stock_qty,
							conversion_factor: item.conversion_factor,
							weight_per_unit: item.weight_per_unit,
							uom: item.uom,
							weight_uom: item.weight_uom,
							manufacturer: item.manufacturer,
							stock_uom: item.stock_uom,
							pos_profile: cint(me.frm.doc.is_pos) ? me.frm.doc.pos_profile : '',
							cost_center: item.cost_center,
							tax_category: me.frm.doc.tax_category,
							item_tax_template: item.item_tax_template,
							child_docname: item.name,
							is_old_subcontracting_flow: me.frm.doc.is_old_subcontracting_flow,
						}
					},

					callback: function(r) {
						if(!r.exc) {
							frappe.run_serially([
								() => {
									var d = locals[cdt][cdn];
									me.add_taxes_from_item_tax_template(d.item_tax_rate);
									if (d.free_item_data) {
										me.apply_product_discount(d);
									}
								},
								() => {
									// for internal customer instead of pricing rule directly apply valuation rate on item
									if (me.frm.doc.is_internal_customer || me.frm.doc.is_internal_supplier) {
										me.get_incoming_rate(item, me.frm.posting_date, me.frm.posting_time,
											me.frm.doc.doctype, me.frm.doc.company);
									} else {
										me.frm.script_manager.trigger("price_list_rate", cdt, cdn);
									}
								},
								() => {
									if (me.frm.doc.is_internal_customer || me.frm.doc.is_internal_supplier) {
										me.calculate_taxes_and_totals();
									}
								},
								() => me.toggle_conversion_factor(item),
								() => {
									if (show_batch_dialog)
										return frappe.db.get_value("Item", item.item_code, ["has_batch_no", "has_serial_no"])
											.then((r) => {
												if (r.message &&
												(r.message.has_batch_no || r.message.has_serial_no)) {
													frappe.flags.hide_serial_batch_dialog = false;
												}
											});
								},
								() => {
									// check if batch serial selector is disabled or not
									if (show_batch_dialog && !frappe.flags.hide_serial_batch_dialog)
										return frappe.db.get_single_value('Stock Settings', 'disable_serial_no_and_batch_selector')
											.then((value) => {
												if (value) {
													frappe.flags.hide_serial_batch_dialog = true;
												}
											});
								},
								() => {
									if(show_batch_dialog && !frappe.flags.hide_serial_batch_dialog) {
										var d = locals[cdt][cdn];
										$.each(r.message, function(k, v) {
											if(!d[k]) d[k] = v;
										});

										if (d.has_batch_no && d.has_serial_no) {
											d.batch_no = undefined;
										}

										// erpnext.show_serial_batch_selector(me.frm, d, (item) => {
										// 	me.frm.script_manager.trigger('qty', item.doctype, item.name);
										// 	if (!me.frm.doc.set_warehouse)
										// 		me.frm.script_manager.trigger('warehouse', item.doctype, item.name);
										// 	me.apply_price_list(item, true);
										// }, undefined, !frappe.flags.hide_serial_batch_dialog);
									}
								},
								() => me.conversion_factor(doc, cdt, cdn, true),
								() => me.remove_pricing_rule(item),
								() => {
									if (item.apply_rule_on_other_items) {
										let key = item.name;
										me.apply_rule_on_other_items({key: item});
									}
								},
								() => {
									var company_currency = me.get_company_currency();
									me.update_item_grid_labels(company_currency);
								}
							]);
						}
					}
				});
			}
		}
	}

 };

extend_cscript(cur_frm.cscript, new minhase_customisations.CustomSalesInvoiceController({frm: cur_frm}));

