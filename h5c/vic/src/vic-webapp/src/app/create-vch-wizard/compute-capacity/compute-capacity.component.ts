/*
 Copyright 2017 VMware, Inc. All Rights Reserved.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/
import { Component, OnInit, ViewChildren, QueryList, Input } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import {
  getNumericValidatorsArray,
  unlimitedPattern
} from '../../shared/utils/validators';

import { ComputeResourceTreenodeComponent } from './compute-resource-treenode.component';
import { CreateVchWizardService } from '../create-vch-wizard.service';
import { DC_CLUSTER } from '../../shared/constants';
import { Observable } from 'rxjs/Observable';
import { GlobalsService } from './../../shared/globals.service';
import { ComputeResource } from '../../interfaces/compute.resource';
import { getMorIdFromObjRef } from '../../shared/utils/object-reference';
import 'rxjs/add/observable/timer';
import { ServerInfo } from '../../shared/vSphereClientSdkTypes';
import { flattenArray } from '../../shared/utils/array-utils';
import { I18nService } from '../../shared';

const endpointMemoryDefaultValue = 2048;

@Component({
  selector: 'vic-vch-creation-compute-capacity',
  templateUrl: './compute-capacity.html',
  styleUrls: ['./compute-capacity.scss']
})
export class ComputeCapacityComponent implements OnInit {

  @Input()
  public set vchName(vchName: string) {
    this._currentVchName = vchName;
    this.validateVMGroupsNameAndDrs(this.vmsGroups, this.isClusterDrsEnabled);
  }

  public form: FormGroup;
  public datacenter: any[] = [];
  public dcObj: ComputeResource;
  public serviceGuid: string;
  public clusters: any[] = [];
  public resources: any[] = [];
  public isTreeLoading = false;
  public inAdvancedMode = false;
  public resourceLimits: any = {
    cpu: { maxUsage: null, minUsage: null, unreservedForPool: null },
    memory: { maxUsage: null, minUsage: null, unreservedForPool: null }
  };
  public selectedObject: ComputeResource;
  public selectedResourceObjRef: string;
  public serversInfo: ServerInfo[];
  public selectedResourceIsCluster = false;
  public vmGroupNameIsValid = false;
  public isClusterDrsEnabled = false;
  public vmsGroups = [];

  private _selectedComputeResource: string;
  private _currentVchName: string;

  @ViewChildren(ComputeResourceTreenodeComponent)
  treenodeComponents: QueryList<ComputeResourceTreenodeComponent>;

  constructor(
    private formBuilder: FormBuilder,
    private createWzService: CreateVchWizardService,
    private globalsService: GlobalsService,
    public i18n: I18nService
  ) {
    // create a FormGroup instance
    this.form = formBuilder.group({
      cpuLimit: [
        'Unlimited',
        getNumericValidatorsArray(true)
      ],
      memoryLimit: [
        'Unlimited',
        getNumericValidatorsArray(true)
      ],
      cpuReservation: [
        '1',
        getNumericValidatorsArray(false)
      ],
      // TODO: make cpuShares and memoryShares required on advanced mode
      cpuShares: 'normal',
      memoryShares: 'normal',
      memoryReservation: [
        '1',
        getNumericValidatorsArray(false)
      ],
      endpointCpu: [
        '1',
        getNumericValidatorsArray(false)
      ],
      endpointMemory: [
        endpointMemoryDefaultValue,
        getNumericValidatorsArray(false)
      ],
      vmHostAffinity: [
        false
      ]
    });
  }

  // TODO: add units selectors to compute fields

  ngOnInit() {
    this.serversInfo = this.globalsService.getWebPlatform().getUserSession().serversInfo;
    const obsArr = this.serversInfo.map(serverInfo => this.createWzService.getDatacenter(serverInfo.serviceGuid));
    Observable.zip(...obsArr)
      .subscribe(results => {
        this.datacenter = flattenArray(results);
      });
  }

  /**
   * Get the latest list of Hosts, VirtualApps and ResourcePools
   * @param {string} clusterValue
   */
  loadResources(clusterValue: string) {
    this.isTreeLoading = true;
    this.createWzService
      .getHostsAndResourcePools(clusterValue)
      .subscribe(resources => {
        this.resources = resources;
        this.isTreeLoading = false;
      });
  }

  /**
   * extract the datacenter moid from the object reference string
   *
   */
  getDataCenterId (dcObj: string) {
      const dcIds = dcObj.split(':');
      if (dcIds[2] === 'Datacenter') {
        // e.g: urn:vmomi:Datacenter:dc-test:00000000-0000-0000-0000-000000000000
        return dcIds[3];
      }
  }

  get dcId () {
    return getMorIdFromObjRef(this.dcObj.objRef);
  }

  /**
   * Set the compute resource selected by the user.
   * @param {obj: ComputeResource; parentClusterObj?: ComputeResource; datacenterObj: ComputeResource}
   */
  selectComputeResource(payload: {
    obj: ComputeResource | any;
    parentClusterObj?: ComputeResource | any;
    datacenterObj: ComputeResource | any
  }) {
    const nodeTypeId = payload.obj.nodeTypeId;
    const isCluster = nodeTypeId === DC_CLUSTER;
    const resourceObj = payload.obj.objRef;
    const dcObj = payload.datacenterObj.objRef;
    this.dcObj = payload.datacenterObj;
    this.selectedResourceIsCluster = isCluster;

    let computeResource = `/${this.dcObj.text}/host`;
    let resourceObjForResourceAllocations = resourceObj;

    if (isCluster) {
      computeResource = `${computeResource}/${payload.obj.realName}`;
      resourceObjForResourceAllocations = payload.obj.aliases[0];
    } else {
      this.form.controls['vmHostAffinity'].setValue(false);
      computeResource = payload.parentClusterObj ?
        `${computeResource}/${payload.parentClusterObj.text}/${payload.obj.realName}` :
        `${computeResource}/${payload.obj.realName}`;
    }
    this.selectedResourceObjRef = resourceObj;
    this.selectedObject = payload.obj;
    this._selectedComputeResource = computeResource;

    // set active class on the treenodecomponent whose datacenter object reference is
    // the same as datacenterObj.objRef
    if (this.treenodeComponents) {
      this.treenodeComponents
        .filter(component => component.datacenter.objRef !== dcObj)
        .forEach(component => {
          component.unselectComputeResource();
        });
    }

    // if it is a cluster, we get the cluster vm groups, otherwise set to empty array observable
    const vmGroupsObs: Observable<any[]> = isCluster ?
      this.createWzService.getClusterVMGroups(this.selectedResourceObjRef) : Observable.of([]);

    const isDrsEnabled: Observable<boolean> = isCluster ?
      this.createWzService.getClusterDrsStatus(this.selectedResourceObjRef) : Observable.of(false);

    const allocationsObs: Observable<any[]> = this.createWzService
      .getResourceAllocationsInfo(resourceObjForResourceAllocations, isCluster);

    Observable.zip(allocationsObs, vmGroupsObs, isDrsEnabled)
      .subscribe(([allocationsInfo, groups, drsStatus]) => {
        const cpu = allocationsInfo['cpu'];
        const memory = allocationsInfo['memory'];
        this.resourceLimits = allocationsInfo;
        this.vmsGroups = groups;

        // set max limit validator for cpu maxUsage
        this.form.get('cpuLimit').setValidators([
          ...getNumericValidatorsArray(true),
          Validators.max(cpu['maxUsage'])
        ]);

        // set max limit validator for memory maxUsage
        this.form.get('memoryLimit').setValidators([
          ...getNumericValidatorsArray(true),
          Validators.max(memory['maxUsage'])
        ]);

        // validates the name of the group and drsStatus
        this.validateVMGroupsNameAndDrs(this.vmsGroups, drsStatus);

        if (this.inAdvancedMode) {
          // set max limit validator for endpointMemory
          this.form.get('endpointMemory').setValidators([
            ...getNumericValidatorsArray(false),
            Validators.max(memory['maxUsage'])
          ]);

          // set max limit validator for cpu unreservedForPool
          this.form.get('cpuReservation').setValidators([
            ...getNumericValidatorsArray(false),
            Validators.max(cpu['unreservedForPool'])
          ]);

          // set max limit validator for memory unreservedForPool
          this.form.get('memoryReservation').setValidators([
            ...getNumericValidatorsArray(false),
            Validators.max(memory['unreservedForPool'])
          ]);

          // This prevents the next button from getting disabled when the user selects a host or cluster that has less RAM
          // available for VM endpoint than the default value. As a solution, we set the smaller value between the default
          // value and memory['maxUsage']
          this.form.get('endpointMemory').setValue(Math.min(memory['maxUsage'], endpointMemoryDefaultValue) + '', { emitEvent: false });
        } else {
          this.form.get('endpointMemory').setValidators([]);
          this.form.get('cpuReservation').setValidators([]);
          this.form.get('memoryReservation').setValidators([]);
        }

        this.form.get('cpuLimit').updateValueAndValidity();
        this.form.get('memoryLimit').updateValueAndValidity();
        this.form.get('endpointMemory').updateValueAndValidity();
        this.form.get('cpuReservation').updateValueAndValidity();
        this.form.get('memoryReservation').updateValueAndValidity();
      });
  }

  /**
   * Validates if there is a group on the selectedResource with the same name as the VCH. Group name is valid if there is either not a group
   * or if there is a group and that group does not contain a name matching the current vch name.
   */
  private validateVMGroupsNameAndDrs(groups: any[], drsStatus: boolean) {
    const clusterGroups = 'ClusterComputeResource/configurationEx/group';
    this.vmGroupNameIsValid = !groups[clusterGroups] ||
      (groups[clusterGroups] && !groups[clusterGroups]
        .some(group => group['name'] === this._currentVchName));

    this.isClusterDrsEnabled = drsStatus;

    if (!this.vmGroupNameIsValid || !this.isClusterDrsEnabled) {
      this.form.controls['vmHostAffinity'].setValue(false);
    }
  }

  get selectedComputeResource() {
    return this._selectedComputeResource;
  }

  onPageLoad() {
    // if compute resource is already selected return here
    if (this.selectedComputeResource) {
      return;
    }
  }

  onCommit(): Observable<any> {
    const errs: string[] = [];
    let formErrors = null;
    const results: any = {};

    if (!this.selectedComputeResource) {
      errs.push('Please choose a valid compute resource');
      formErrors = { invalidComputeResource: true };
    }

    this.form.setErrors(formErrors);

    if (this.form.invalid) {
      return Observable.throw(errs);
    } else {
      const cpuLimitValue = this.form.get('cpuLimit').value;
      const memoryLimitValue = this.form.get('memoryLimit').value;

      results['computeResource'] = this.selectedComputeResource;
      results['cpu'] = unlimitedPattern.test(cpuLimitValue) ? '0' : cpuLimitValue;
      results['memory'] = unlimitedPattern.test(memoryLimitValue) ? '0' : memoryLimitValue;
      if (this.inAdvancedMode) {
        results['cpuReservation'] = this.form.get('cpuReservation').value;
        results['cpuShares'] = this.form.get('cpuShares').value;
        results['memoryReservation'] = this.form.get('memoryReservation').value;
        results['memoryShares'] = this.form.get('memoryShares').value;
        results['endpointCpu'] = this.form.get('endpointCpu').value;
        results['endpointMemory'] = this.form.get('endpointMemory').value;
        results['vmHostAffinity'] = this.form.get('vmHostAffinity').value;
      }
      return Observable.of({ computeCapacity: results });
    }
  }

  toggleAdvancedMode() {
    this.inAdvancedMode = !this.inAdvancedMode;
  }

  getDcs (serverInfo: ServerInfo): ComputeResource[] {
    return this.datacenter.filter((item: ComputeResource) => item.objRef.indexOf(serverInfo.serviceGuid) > -1);
  }
}
