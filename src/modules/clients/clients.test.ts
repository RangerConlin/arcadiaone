import test from "node:test";
import assert from "node:assert/strict";
import { clientSchema, contactSchema } from "./validation";
import { canEditClient, clientVisibilityWhere } from "./authorization";

const admin = { id:"admin", organizationId:"org-a", employeeId:"e1", email:"a@example.com", role:"ADMIN" as const, displayName:"Admin" };
const manager = { ...admin, id:"manager", employeeId:"m1", role:"MANAGER" as const };
const employee = { ...admin, id:"employee", employeeId:"e2", role:"EMPLOYEE" as const };
test("prospects convert to active with the same simple client input",()=>{const base={name:"Example Client",status:"PROSPECT",type:"BUSINESS",displayName:"",clientNumber:"",website:"",mainPhone:"",generalEmail:"",addressLine1:"",addressLine2:"",city:"",stateProvince:"",postalCode:"",country:"",notes:""};assert.equal(clientSchema.parse(base).status,"PROSPECT");assert.equal(clientSchema.parse({...base,status:"ACTIVE"}).status,"ACTIVE")});
test("contact input supports primary and inactive lifecycle flags",()=>{const c=contactSchema.parse({firstName:"Ada",lastName:"Lovelace",title:"",email:"ada@example.com",phone:"",mobilePhone:"",preferredContactMethod:"EMAIL",primary:true,active:false,notes:""});assert.equal(c.primary,true);assert.equal(c.active,false)});
test("client authorization scopes every role to an organization",()=>{assert.deepEqual(clientVisibilityWhere(admin),{organizationId:"org-a"});assert.equal((clientVisibilityWhere(manager) as {organizationId:string}).organizationId,"org-a");assert.equal((clientVisibilityWhere(employee) as {organizationId:string}).organizationId,"org-a")});
test("only administrators or owning/managing managers can edit",()=>{const own={createdByUserId:"manager",projects:[]};assert.equal(canEditClient(admin,own),true);assert.equal(canEditClient(manager,own),true);assert.equal(canEditClient(employee,own),false);assert.equal(canEditClient({...manager,id:"other"},{createdByUserId:"none",projects:[{projectManagerId:"m1"}]}),true)});
