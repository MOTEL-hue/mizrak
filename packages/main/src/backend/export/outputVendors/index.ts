import budget from './budget/budget';
import csv from './csv/csv';
import { googleSheetsOutputVendor } from './googleSheets/googleSheets';
import json from './json/json';
import { ynabOutputVendor } from './ynab/ynab';

const outputVendors = [csv, json, budget, ynabOutputVendor, googleSheetsOutputVendor];

export default outputVendors;
